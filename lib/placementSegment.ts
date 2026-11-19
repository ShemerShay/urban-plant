/**
 * Placement Segment boundaries share the statement that changes occupancy or price.
 * Requires a preceding CTE named `written` with id, partner_location_id,
 * plant_variant_id, pocket_id, current_offer_id, pot_id.
 * Callers must read `segment_guard` so the CTEs run.
 *
 * Plant supplier unit cost is snapshotted only when a Cycle opens, then copied
 * onto later Segments of that Cycle. Pot supplier unit cost is snapshotted when
 * the pot changes and copied when the same pot continues. Costs are never stored
 * on pos_spots.
 *
 * Deactivate closes the current Segment and leaves the Cycle open. Reactivate
 * opens a new Segment on that Cycle, inheriting plant/pot costs. Inactive time
 * is therefore not Segment/Pocket exposure and does not receive scan attribution.
 */

import { sql } from "@/lib/db";
import type { CycleEndReason, PlacementKind } from "@/lib/placementCycle";

export const PLACEMENT_PLANT_UNIT_COST_SOURCE = "plants.supplier_price@cycle" as const;
export const PLACEMENT_POT_UNIT_COST_SOURCE = "pots.supplier_price@segment" as const;

export function placementBoundaryCtes(input: {
  shouldClose: boolean;
  shouldOpen: boolean;
  closeReason: CycleEndReason;
  placementKind?: PlacementKind;
  pauseSegment?: boolean;
  resumeSegment?: boolean;
}) {
  const shouldClose = input.shouldClose;
  const shouldOpen = input.shouldOpen;
  const closeReason = input.closeReason;
  const placementKind: PlacementKind = input.placementKind ?? "initial";
  const pauseSegment = Boolean(input.pauseSegment);
  const resumeSegment = Boolean(input.resumeSegment);
  return sql`
    , closed_cycles AS (
      UPDATE placement_cycles c
      SET
        ended_at = now(),
        end_reason = ${closeReason}
      FROM written w
      WHERE ${shouldClose}
        AND c.pos_spot_id = w.id
        AND c.ended_at IS NULL
      RETURNING c.id
    ),
    closed_cycles_done AS (
      SELECT COUNT(*)::int AS n FROM closed_cycles
    ),
    opened_cycles AS (
      INSERT INTO placement_cycles (
        id,
        pos_spot_id,
        plant_variant_id,
        partner_id,
        partner_name,
        partner_location_id,
        partner_location_name,
        plant_id,
        plant_name,
        size_label,
        placement_kind,
        started_at,
        ended_at,
        end_reason,
        order_id
      )
      SELECT
        gen_random_uuid(),
        w.id,
        w.plant_variant_id,
        NULLIF(btrim(pr.id), ''),
        NULLIF(btrim(pr.name), ''),
        NULLIF(btrim(w.partner_location_id), ''),
        NULLIF(btrim(ploc.name), ''),
        NULLIF(btrim(pl.id), ''),
        NULLIF(btrim(pl.name), ''),
        NULLIF(btrim(pv.size_label), ''),
        ${placementKind},
        now(),
        NULL,
        NULL,
        NULL
      FROM written w
      CROSS JOIN closed_cycles_done
      LEFT JOIN partner_locations ploc ON ploc.id = w.partner_location_id
      LEFT JOIN partners pr ON pr.id = ploc.partner_id
      LEFT JOIN plant_variants pv ON pv.id = w.plant_variant_id
      LEFT JOIN plants pl ON pl.id = pv.plant_id
      WHERE ${shouldOpen}
        AND w.plant_variant_id IS NOT NULL
      RETURNING id, pos_spot_id, plant_variant_id
    ),
    closed_cycle_segments AS (
      UPDATE placement_segments s
      SET ended_at = now()
      FROM closed_cycles cc
      WHERE s.placement_cycle_id = cc.id
        AND s.ended_at IS NULL
      RETURNING s.id
    ),
    paused_segments AS (
      UPDATE placement_segments s
      SET ended_at = now()
      FROM written w
      INNER JOIN placement_cycles c
        ON c.pos_spot_id = w.id
       AND c.ended_at IS NULL
      WHERE ${pauseSegment}
        AND s.placement_cycle_id = c.id
        AND s.ended_at IS NULL
      RETURNING s.id
    ),
    exposure_targets AS (
      SELECT
        s.id AS segment_id,
        c.id AS cycle_id,
        c.plant_variant_id,
        w.pocket_id,
        w.current_offer_id,
        o.sellable_variant_id,
        w.pot_id
      FROM written w
      INNER JOIN placement_cycles c
        ON c.pos_spot_id = w.id
       AND c.ended_at IS NULL
      INNER JOIN placement_segments s
        ON s.placement_cycle_id = c.id
       AND s.ended_at IS NULL
      LEFT JOIN offers o ON o.id = w.current_offer_id
      WHERE ${shouldClose} = false
        AND ${shouldOpen} = false
        AND ${pauseSegment} = false
        AND ${resumeSegment} = false
        AND (
          s.pocket_id IS DISTINCT FROM w.pocket_id
          OR s.offer_id IS DISTINCT FROM w.current_offer_id
          OR s.sellable_variant_id IS DISTINCT FROM o.sellable_variant_id
          OR s.pot_id IS DISTINCT FROM w.pot_id
        )
    ),
    exposure_close AS (
      UPDATE placement_segments s
      SET ended_at = now()
      FROM exposure_targets t
      WHERE s.id = t.segment_id
        AND s.ended_at IS NULL
      RETURNING
        s.placement_cycle_id,
        t.pocket_id,
        t.current_offer_id,
        t.sellable_variant_id,
        t.pot_id,
        t.plant_variant_id,
        s.plant_unit_cost AS prev_plant_unit_cost,
        s.plant_unit_cost_source AS prev_plant_unit_cost_source,
        s.pot_id AS prev_pot_id,
        s.pot_unit_cost AS prev_pot_unit_cost,
        s.pot_unit_cost_source AS prev_pot_unit_cost_source,
        s.pot_name AS prev_pot_name
    ),
    resume_targets AS (
      SELECT
        c.id AS cycle_id,
        w.pocket_id,
        w.current_offer_id AS offer_id,
        o.sellable_variant_id,
        w.pot_id,
        c.plant_variant_id,
        prev.plant_unit_cost AS prev_plant_unit_cost,
        prev.plant_unit_cost_source AS prev_plant_unit_cost_source,
        prev.pot_id AS prev_pot_id,
        prev.pot_unit_cost AS prev_pot_unit_cost,
        prev.pot_unit_cost_source AS prev_pot_unit_cost_source,
        prev.pot_name AS prev_pot_name
      FROM written w
      INNER JOIN placement_cycles c
        ON c.pos_spot_id = w.id
       AND c.ended_at IS NULL
      LEFT JOIN offers o ON o.id = w.current_offer_id
      LEFT JOIN LATERAL (
        SELECT
          s.plant_unit_cost,
          s.plant_unit_cost_source,
          s.pot_id,
          s.pot_unit_cost,
          s.pot_unit_cost_source,
          s.pot_name
        FROM placement_segments s
        WHERE s.placement_cycle_id = c.id
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT 1
      ) prev ON true
      WHERE ${resumeSegment}
        AND w.plant_variant_id IS NOT NULL
    ),
    opened_segments AS (
      INSERT INTO placement_segments (
        id,
        placement_cycle_id,
        started_at,
        ended_at,
        pocket_id,
        pocket_name,
        offer_id,
        consumer_price,
        sellable_variant_id,
        pot_id,
        pot_name,
        plant_unit_cost,
        plant_unit_cost_source,
        pot_unit_cost,
        pot_unit_cost_source,
        total_supplier_unit_cost
      )
      SELECT
        gen_random_uuid(),
        src.cycle_id,
        now(),
        NULL,
        src.pocket_id,
        CASE WHEN src.pocket_id IS NULL THEN NULL ELSE pk.name END,
        src.offer_id,
        o.consumer_price,
        COALESCE(src.sellable_variant_id, o.sellable_variant_id),
        src.pot_id,
        CASE
          WHEN src.pot_id IS NULL THEN NULL
          WHEN src.is_new_cycle OR src.pot_id IS DISTINCT FROM src.prev_pot_id
            THEN NULLIF(btrim(pot.name), '')
          ELSE src.prev_pot_name
        END,
        CASE
          WHEN src.is_new_cycle THEN
            CASE
              WHEN pl.supplier_price IS NULL OR pl.supplier_price < 0 THEN NULL
              ELSE round(pl.supplier_price, 2)
            END
          ELSE src.prev_plant_unit_cost
        END,
        CASE
          WHEN src.is_new_cycle THEN
            CASE
              WHEN pl.supplier_price IS NULL OR pl.supplier_price < 0 THEN NULL
              ELSE ${PLACEMENT_PLANT_UNIT_COST_SOURCE}
            END
          ELSE src.prev_plant_unit_cost_source
        END,
        CASE
          WHEN src.pot_id IS NULL THEN NULL
          WHEN src.is_new_cycle OR src.pot_id IS DISTINCT FROM src.prev_pot_id THEN
            CASE
              WHEN pot.supplier_price IS NULL OR pot.supplier_price < 0 THEN NULL
              ELSE round(pot.supplier_price, 2)
            END
          ELSE src.prev_pot_unit_cost
        END,
        CASE
          WHEN src.pot_id IS NULL THEN NULL
          WHEN src.is_new_cycle OR src.pot_id IS DISTINCT FROM src.prev_pot_id THEN
            CASE
              WHEN pot.supplier_price IS NULL OR pot.supplier_price < 0 THEN NULL
              ELSE ${PLACEMENT_POT_UNIT_COST_SOURCE}
            END
          ELSE src.prev_pot_unit_cost_source
        END,
        CASE
          WHEN src.is_new_cycle THEN
            CASE
              WHEN pl.supplier_price IS NULL OR pl.supplier_price < 0 THEN NULL
              WHEN src.pot_id IS NULL THEN round(pl.supplier_price, 2)
              WHEN pot.supplier_price IS NULL OR pot.supplier_price < 0 THEN NULL
              ELSE round(round(pl.supplier_price, 2) + round(pot.supplier_price, 2), 2)
            END
          WHEN src.prev_plant_unit_cost IS NULL THEN NULL
          WHEN src.pot_id IS NULL THEN round(src.prev_plant_unit_cost, 2)
          WHEN src.pot_id IS DISTINCT FROM src.prev_pot_id THEN
            CASE
              WHEN pot.supplier_price IS NULL OR pot.supplier_price < 0 THEN NULL
              ELSE round(src.prev_plant_unit_cost + round(pot.supplier_price, 2), 2)
            END
          WHEN src.prev_pot_unit_cost IS NULL THEN NULL
          ELSE round(src.prev_plant_unit_cost + src.prev_pot_unit_cost, 2)
        END
      FROM (
        SELECT
          oc.id AS cycle_id,
          w.pocket_id,
          w.current_offer_id AS offer_id,
          o.sellable_variant_id,
          w.pot_id,
          oc.plant_variant_id,
          TRUE AS is_new_cycle,
          NULL::numeric AS prev_plant_unit_cost,
          NULL::text AS prev_plant_unit_cost_source,
          NULL::uuid AS prev_pot_id,
          NULL::numeric AS prev_pot_unit_cost,
          NULL::text AS prev_pot_unit_cost_source,
          NULL::text AS prev_pot_name
        FROM opened_cycles oc
        INNER JOIN written w ON w.id = oc.pos_spot_id
        LEFT JOIN offers o ON o.id = w.current_offer_id
        UNION ALL
        SELECT
          ec.placement_cycle_id,
          ec.pocket_id,
          ec.current_offer_id,
          ec.sellable_variant_id,
          ec.pot_id,
          ec.plant_variant_id,
          FALSE,
          ec.prev_plant_unit_cost,
          ec.prev_plant_unit_cost_source,
          ec.prev_pot_id,
          ec.prev_pot_unit_cost,
          ec.prev_pot_unit_cost_source,
          ec.prev_pot_name
        FROM exposure_close ec
        INNER JOIN exposure_targets t ON t.cycle_id = ec.placement_cycle_id
        UNION ALL
        SELECT
          rt.cycle_id,
          rt.pocket_id,
          rt.offer_id,
          rt.sellable_variant_id,
          rt.pot_id,
          rt.plant_variant_id,
          FALSE,
          rt.prev_plant_unit_cost,
          rt.prev_plant_unit_cost_source,
          rt.prev_pot_id,
          rt.prev_pot_unit_cost,
          rt.prev_pot_unit_cost_source,
          rt.prev_pot_name
        FROM resume_targets rt
      ) src
      CROSS JOIN (SELECT COUNT(*)::int AS n FROM closed_cycle_segments) closed_seg_done
      INNER JOIN offers o ON o.id = src.offer_id
      LEFT JOIN pockets pk ON pk.id = src.pocket_id
      LEFT JOIN plant_variants pv ON pv.id = src.plant_variant_id
      LEFT JOIN plants pl ON pl.id = COALESCE(pv.plant_id, o.product_id)
      LEFT JOIN pots pot ON pot.id = src.pot_id
      WHERE (
        src.pocket_id IS NULL
        OR (pk.name IS NOT NULL AND length(trim(pk.name)) > 0)
      )
      RETURNING id
    ),
    segment_guard AS (
      SELECT 1 / CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM closed_cycles cc
          INNER JOIN placement_segments s
            ON s.placement_cycle_id = cc.id
           AND s.ended_at IS NULL
        )
         AND (SELECT COUNT(*) FROM closed_cycle_segments) >= 0
         AND (SELECT COUNT(*) FROM paused_segments) >= 0
         AND (
           ${pauseSegment} = false
           OR NOT EXISTS (
             SELECT 1
             FROM written w
             INNER JOIN placement_cycles c
               ON c.pos_spot_id = w.id
              AND c.ended_at IS NULL
             INNER JOIN placement_segments s
               ON s.placement_cycle_id = c.id
              AND s.ended_at IS NULL
           )
         )
         AND (SELECT COUNT(*) FROM exposure_targets) = (SELECT COUNT(*) FROM exposure_close)
         AND (SELECT COUNT(*) FROM opened_segments)
             = (SELECT COUNT(*) FROM opened_cycles)
             + (SELECT COUNT(*) FROM exposure_close)
             + (SELECT COUNT(*) FROM resume_targets)
        THEN 1
        ELSE 0
      END AS seg_ok
    )
  `;
}

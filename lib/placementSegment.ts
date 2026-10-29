/**
 * Placement Segment boundaries share the statement that changes occupancy or price.
 * Requires a preceding CTE named `written` with id, plant_variant_id, pocket_id,
 * current_offer_id, pot_id. Callers must read `segment_guard` so the CTEs run.
 */

import { sql } from "@/lib/db";
import type { CycleEndReason } from "@/lib/placementCycle";

export function placementBoundaryCtes(input: {
  shouldClose: boolean;
  shouldOpen: boolean;
  closeReason: CycleEndReason;
}) {
  const shouldClose = input.shouldClose;
  const shouldOpen = input.shouldOpen;
  const closeReason = input.closeReason;
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
        id, pos_spot_id, plant_variant_id, started_at, ended_at, end_reason, order_id
      )
      SELECT gen_random_uuid(), w.id, w.plant_variant_id, now(), NULL, NULL, NULL
      FROM written w
      CROSS JOIN closed_cycles_done
      WHERE ${shouldOpen}
        AND w.plant_variant_id IS NOT NULL
      RETURNING id, pos_spot_id
    ),
    closed_cycle_segments AS (
      UPDATE placement_segments s
      SET ended_at = now()
      FROM closed_cycles cc
      WHERE s.placement_cycle_id = cc.id
        AND s.ended_at IS NULL
      RETURNING s.id
    ),
    exposure_targets AS (
      SELECT
        s.id AS segment_id,
        c.id AS cycle_id,
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
      RETURNING s.placement_cycle_id, t.pocket_id, t.current_offer_id, t.sellable_variant_id, t.pot_id
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
        pot_id
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
        src.pot_id
      FROM (
        SELECT
          oc.id AS cycle_id,
          w.pocket_id,
          w.current_offer_id AS offer_id,
          o.sellable_variant_id,
          w.pot_id
        FROM opened_cycles oc
        INNER JOIN written w ON w.id = oc.pos_spot_id
        LEFT JOIN offers o ON o.id = w.current_offer_id
        UNION ALL
        SELECT
          ec.placement_cycle_id,
          ec.pocket_id,
          ec.current_offer_id,
          ec.sellable_variant_id,
          ec.pot_id
        FROM exposure_close ec
        INNER JOIN exposure_targets t ON t.cycle_id = ec.placement_cycle_id
      ) src
      CROSS JOIN (SELECT COUNT(*)::int AS n FROM closed_cycle_segments) closed_seg_done
      INNER JOIN offers o ON o.id = src.offer_id
      LEFT JOIN pockets pk ON pk.id = src.pocket_id
      WHERE (
        src.pocket_id IS NULL
        OR (pk.name IS NOT NULL AND length(trim(pk.name)) > 0)
      )
      RETURNING id
    ),
    segment_guard AS (
      SELECT 1 / CASE
        WHEN (SELECT COUNT(*) FROM closed_cycles) = (SELECT COUNT(*) FROM closed_cycle_segments)
         AND (SELECT COUNT(*) FROM exposure_targets) = (SELECT COUNT(*) FROM exposure_close)
         AND (SELECT COUNT(*) FROM opened_segments)
             = (SELECT COUNT(*) FROM opened_cycles) + (SELECT COUNT(*) FROM exposure_close)
        THEN 1
        ELSE 0
      END AS seg_ok
    )
  `;
}

/**
 * English → Hebrew for plant careInstructions lines shown in purchase emails.
 * Exact-match only; unknown English lines are left unchanged.
 */

const CARE_INSTRUCTION_HE: Record<string, string> = {
  // Catalog seed
  "Bright indirect light; avoid harsh midday sun on leaves.":
    "אור עקיף בהיר; הימנעו משמש חזקה בצהריים על העלים.",
  "Water when the top soil feels dry.": "השקו כשהאדמה העליונה מורגשת יבשה.",
  "Wipe leaves occasionally for shine.": "נגבו את העלים מדי פעם לשמירה על ברק.",
  "Keep soil lightly moist; avoid soggy roots.":
    "שמרו על לחות קלה באדמה; הימנעו משורשים רטובים מדי.",
  "Higher humidity helps leaf edges stay crisp.":
    "לחות גבוהה יותר עוזרת לשמור על שולי העלים חדים.",
  "Rotate weekly for even growth.": "סובבו מדי שבוע לצמיחה אחידה.",
  "Keep evenly moist but not waterlogged.":
    "שמרו על לחות אחידה אך לא על אדמה ספוגה במים.",
  "Prune brown stems to keep it airy.": "גזמו גבעולים חומים כדי לשמור על מראה אוורירי.",
  "Protect from drying heat vents.": "הגנו מפני פתחי חימום מייבשים.",
  "Keep in bright indirect sun for at least 6 hours daily.":
    "הציבו באור שמש עקיף בהיר לפחות 6 שעות ביום.",
  "Let the top 2-3 cm of soil dry between watering.":
    "תנו ל־2–3 ס״מ העליונים של האדמה להתייבש בין השקיות.",
  "Rotate the pot weekly for balanced growth.": "סובבו את העציץ מדי שבוע לצמיחה מאוזנת.",
  "Wipe leaves gently once a month to remove dust.":
    "נגבו בעדינות את העלים פעם בחודש להסרת אבק.",

  // Imported catalog
  "Let the soil dry fully between waterings": "תנו לאדמה להתייבש לחלוטין בין השקיות",
  "Water much less in winter": "השקו הרבה פחות בחורף",
  "Avoid waterlogged soil": "הימנעו מאדמה ספוגה במים",
  "Wear gloves when pruning or repotting": "השתמשו בכפפות בעת גיזום או החלפת מצע",
  "Milky sap is irritating and toxic, so keep it away from pets and children.":
    "המוהל החלבי מגרה ורעיל — הרחיקו מחיות מחמד וילדים.",

  "Allow the soil to partially dry": "תנו לאדמה להתייבש חלקית",
  "Avoid cold drafts": "הימנעו מזרמי אוויר קרים",
  "Wipe the leaves occasionally": "נגבו את העלים מדי פעם",
  "Reduce watering in lower light": "הפחיתו השקיה באור חלש",
  "Avoid prolonged wet soil and cold air-conditioning.":
    "הימנעו מאדמה רטובה לאורך זמן וממיזוג קר.",

  "Check the soil before watering": "בדקו את האדמה לפני השקיה",
  "Rotate regularly for even growth": "סובבו באופן קבוע לצמיחה אחידה",
  "Wipe dust from the leaves": "נגבו אבק מהעלים",
  "Keep conditions stable": "שמרו על תנאים יציבים",
  "Sensitive to overwatering, drafts and frequent relocation.":
    "רגיש להשקיה יתרה, לזרמי אוויר ולהעברות תכופות.",

  "Check moisture before watering": "בדקו לחות לפני השקיה",
  "Rotate for even growth": "סובבו לצמיחה אחידה",
  "Trim lightly to maintain the crown": "גזמו בעדינות לשמירה על הכתר",
  "Avoid abrupt relocation": "הימנעו מהעברה פתאומית",
  "Keep the leaves clean": "שמרו על עלים נקיים",
  "It may drop leaves after sudden changes in light, temperature or location.":
    "עלול להשיר עלים אחרי שינויים פתאומיים באור, בטמפרטורה או במיקום.",

  "Let the upper soil dry before watering": "תנו לאדמה העליונה להתייבש לפני השקיה",
  "Give it a support": "ספקו תמיכה",
  "Trim to control length": "גזמו כדי לשלוט באורך",
  "Keep away from harsh afternoon sun. Provide support to encourage mature leaf shape. Contains irritating calcium oxalate crystals if chewed.":
    "הרחיקו משמש חזקה אחר הצהריים. ספקו תמיכה לעידוד צורת עלים בוגרת. מכיל גבישי סידן אוקסלט מגרים אם נלעס.",

  "Keep the mix lightly moist during active growth":
    "שמרו על לחות קלה במצע בתקופת צמיחה פעילה",
  "Let the surface dry slightly between waterings":
    "תנו לפני השטח להתייבש מעט בין השקיות",
  "Provide bright filtered light to encourage flowering":
    "ספקו אור בהיר מסונן לעידוד פריחה",
  "Trim long stems after flowering": "גזמו גבעולים ארוכים אחרי הפריחה",
  "Bright filtered light, stable warmth and proper watering can support future blooming, but flowering is not guaranteed.":
    "אור בהיר מסונן, חום יציב והשקיה נכונה יכולים לתמוך בפריחה עתידית, אך פריחה אינה מובטחת.",

  "Allow the soil to dry fully": "תנו לאדמה להתייבש לחלוטין",
  "Use a loose, fast-drying soil mix": "השתמשו במצע רופף ומהיר ייבוש",
  "Remove only fully dry leaves": "הסירו רק עלים יבשים לחלוטין",
  "Growth is slow": "הצמיחה איטית",
  "Overwatering is the main risk.": "השקיה יתרה היא הסיכון העיקרי.",

  "Allow part of the mix to dry": "תנו לחלק מהמצע להתייבש",
  "Protect from harsh midday sun": "הגנו משמש חזקה בצהריים",
  "Use a loose, airy soil mix": "השתמשו במצע רופף ואוורירי",
  "Reduce watering in winter": "הפחיתו השקיה בחורף",
  "Avoid waterlogged soil.": "הימנעו מאדמה ספוגה במים.",

  "Let part of the mix dry before watering": "תנו לחלק מהמצע להתייבש לפני השקיה",
  "Keep out of harsh midday sun": "הרחיקו משמש חזקה בצהריים",
  "Use an airy soil mix": "השתמשו במצע אוורירי",
  "Reduce watering during cooler months": "הפחיתו השקיה בחודשים קרירים",
  "Avoid harsh sun and waterlogged soil.": "הימנעו משמש חזקה ומאדמה ספוגה במים.",

  "Let part of the soil dry between waterings": "תנו לחלק מהאדמה להתייבש בין השקיות",
  "Trim long vines to encourage fuller growth": "גזמו גפנים ארוכות לעידוד צמיחה מלאה יותר",
  "Keep away from strong direct sun": "הרחיקו משמש ישירה חזקה",
  "Avoid consistently wet soil": "הימנעו מאדמה רטובה באופן קבוע",
  "Sap and foliage should be kept away from pets and small children.":
    "יש להרחיק את המוהל והעלים מחיות מחמד וילדים קטנים.",

  "Allow part of the soil to dry": "תנו לחלק מהאדמה להתייבש",
  "Give it support for larger mature leaves": "ספקו תמיכה לעלים בוגרים גדולים יותר",
  "Avoid harsh direct sun": "הימנעו משמש ישירה חזקה",
  "Toxic if chewed by pets.": "רעיל אם נלעס על ידי חיות מחמד.",

  "Keep evenly moist but never waterlogged":
    "שמרו על לחות אחידה אך לעולם לא על אדמה ספוגה במים",
  "Protect from hot direct sun": "הגנו משמש ישירה חמה",
  "Trim yellow or dry stems at the base": "גזמו גבעולים צהובים או יבשים מהבסיס",
  "Increase humidity if the foliage browns. Fine stems may have small thorns. Berries and foliage are not considered pet-safe.":
    "העלו לחות אם העלווה משחימה. לגבעולים דקים עשויים להיות קוצים קטנים. פירות יער ועלווה אינם נחשבים בטוחים לחיות מחמד.",

  "Rotate a quarter turn every 1–2 weeks": "סובבו רבע סיבוב כל 1–2 שבועות",
  "Avoid moving it frequently": "הימנעו מהזזה תכופה",
  "Sensitive to sudden changes, overwatering and cold drafts":
    "רגיש לשינויים פתאומיים, להשקיה יתרה ולזרמי אוויר קרים",
  "Allow generous space around the canopy.": "השאירו מרווח נדיב סביב החופה.",

  "Allow the soil to dry well between waterings": "תנו לאדמה להתייבש היטב בין השקיות",
  "Give brighter light to keep growth compact": "ספקו אור בהיר יותר לשמירה על צמיחה קומפקטית",
  "Untangle stems gently": "פרקו גבעולים בעדינות",
  "Reduce watering in winter. Avoid overwatering its tuberous roots. Allow most of the potting mix to dry before watering again.":
    "הפחיתו השקיה בחורף. הימנעו מהשקיית יתר של השורשים הפקעתיים. תנו לרוב המצע להתייבש לפני השקיה חוזרת.",
};

/** Translate English care instruction lines to Hebrew (exact match; else original). */
export function translateCareInstructionsToHebrew(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => CARE_INSTRUCTION_HE[line] ?? line);
}

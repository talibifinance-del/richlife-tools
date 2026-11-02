# בדיקות לכלי התמחור

להריץ לפני כל פריסה של `pricing/`:

    node tests/pricing/engine.test.js

ערכי ייחוס, חוקי שימור ו-2,000 קלטים אקראיים. בלי תלויות.

    python3 -m http.server 8791   # משורש הריפו, בחלון נפרד
    node tests/pricing/selftest.mjs http://localhost:8791 /tmp/pricing-shots

דפדפן אמיתי: הקלדה בכל שלב, קישור מוצפן (מול שרת מדומה), הורדת אקסל, PDF, axe, נייד. Playwright ו-axe-core נטענים מ-`build/client-portal/node_modules`, אפשר לשנות עם `PW=`. עם `--live-share` הבדיקה עובדת מול שרת הקישורים האמיתי.

## השוואה לאקסל

דורש `npm i hyperformula@2.7.1 exceljs@4.4.0` בתיקייה זמנית, מחוץ לריפו:

    NODE_MODULES=<tmp>/node_modules PY=python3 node tests/pricing/parity_export.mjs <tmp> tests/pricing/dump_xlsx.py

`parity_export` בודק שהאקסל שהלקוחה מורידה מחושב מחדש למספרים שהוא מציג. ההשוואה מול התבנית המתוקנת נמצאת בריפו הפרטי, ב-`build/pricing-tool/`.

## עדכון שנתי של טבלאות המס

ב-`pricing/engine.js`: `TABLES_2026` ו-`PATUR_CEILING_2026`. לאמת מול כל זכות, ביטוח לאומי ורשות המסים, ואז להריץ את כל הבדיקות.

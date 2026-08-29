const fs = require('fs');
const locales = ['en-US','id-ID','zh-CN','zh-TW','ar-SA','es-MX','ja-JP','ko-KR','pt-BR','ru-RU'];
locales.forEach(l => {
  try {
    const data = JSON.parse(fs.readFileSync(`lib/i18n/locales/${l}.json`, 'utf8'));
    const hasCanvas = !!data.canvas;
    const hasVocational = !!data.vocational;
    console.log(`${l}: OK (canvas=${hasCanvas}, vocational=${hasVocational})`);
  } catch(e) {
    console.error(`${l}: FAIL`, e.message);
  }
});

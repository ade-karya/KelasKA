const fs = require('fs');
const https = require('https');
https.get('https://raw.githubusercontent.com/apache/echarts/master/test/data/map/json/world.json', (res) => {
  const file = fs.createWriteStream('./public/world.json');
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('world.json downloaded');
  });
});

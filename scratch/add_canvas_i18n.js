const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '../lib/i18n/locales');

const translations = {
  'en-US': {
    canvas: {
      paste: "Paste",
      selectAll: "Select All",
      ruler: "Ruler",
      gridlines: "Gridlines",
      gridNone: "None",
      gridSmall: "Small",
      gridMedium: "Medium",
      gridLarge: "Large",
      resetPage: "Reset Current Page",
      unlock: "Unlock",
      cut: "Cut",
      copy: "Copy",
      alignHorizontal: "Align Horizontal",
      alignCenter: "Align Center",
      alignLeft: "Align Left",
      alignRight: "Align Right",
      alignVertical: "Align Vertical",
      alignTop: "Align Top",
      alignBottom: "Align Bottom",
      bringToFront: "Bring to Front",
      bringForward: "Bring Forward",
      sendToBack: "Send to Back",
      sendBackward: "Send Backward",
      setLink: "Set Link",
      group: "Group",
      ungroup: "Ungroup",
      lock: "Lock",
      delete: "Delete"
    },
    vocational: {
      testFeature: "Test Feature",
      vocationalTask: "Vocational Task",
      testFeatureTooltip: "Submit vocational practical training test from current input box"
    }
  },
  'id-ID': {
    canvas: {
      paste: "Tempel",
      selectAll: "Pilih Semua",
      ruler: "Penggaris",
      gridlines: "Garis Kisi",
      gridNone: "Tidak Ada",
      gridSmall: "Kecil",
      gridMedium: "Sedang",
      gridLarge: "Besar",
      resetPage: "Atur Ulang Halaman Ini",
      unlock: "Buka Kunci",
      cut: "Potong",
      copy: "Salin",
      alignHorizontal: "Rata Tengah Horizontal",
      alignCenter: "Rata Tengah Horizontal & Vertikal",
      alignLeft: "Rata Kiri",
      alignRight: "Rata Kanan",
      alignVertical: "Rata Tengah Vertikal",
      alignTop: "Rata Atas",
      alignBottom: "Rata Bawah",
      bringToFront: "Pindahkan ke Depan",
      bringForward: "Maju Satu Tingkat",
      sendToBack: "Pindahkan ke Belakang",
      sendBackward: "Mundur Satu Tingkat",
      setLink: "Atur Tautan",
      group: "Kelompokkan",
      ungroup: "Batal Kelompokkan",
      lock: "Kunci",
      delete: "Hapus"
    },
    vocational: {
      testFeature: "Fitur Pengujian",
      vocationalTask: "Tugas Vokasi",
      testFeatureTooltip: "Kirim pengujian pelatihan praktis vokasi dari kotak input saat ini"
    }
  },
  'zh-CN': {
    canvas: {
      paste: "粘贴",
      selectAll: "全选",
      ruler: "标尺",
      gridlines: "网格线",
      gridNone: "无",
      gridSmall: "小",
      gridMedium: "中",
      gridLarge: "大",
      resetPage: "重置当前页",
      unlock: "解锁",
      cut: "剪切",
      copy: "复制",
      alignHorizontal: "水平居中",
      alignCenter: "水平垂直居中",
      alignLeft: "左对齐",
      alignRight: "右对齐",
      alignVertical: "垂直居中",
      alignTop: "顶部对齐",
      alignBottom: "底部对齐",
      bringToFront: "置于顶层",
      bringForward: "上移一层",
      sendToBack: "置于底层",
      sendBackward: "下移一层",
      setLink: "设置链接",
      group: "组合",
      ungroup: "取消组合",
      lock: "锁定",
      delete: "删除"
    },
    vocational: {
      testFeature: "测试功能",
      vocationalTask: "职教任务",
      testFeatureTooltip: "从当前输入框提交职教实操训练测试"
    }
  },
  'zh-TW': {
    canvas: {
      paste: "貼上",
      selectAll: "全選",
      ruler: "標尺",
      gridlines: "網格線",
      gridNone: "無",
      gridSmall: "小",
      gridMedium: "中",
      gridLarge: "大",
      resetPage: "重置當前頁",
      unlock: "解鎖",
      cut: "剪切",
      copy: "複製",
      alignHorizontal: "水平居中",
      alignCenter: "水平垂直居中",
      alignLeft: "左對齊",
      alignRight: "右對齊",
      alignVertical: "垂直居中",
      alignTop: "頂部對齊",
      alignBottom: "底部對齊",
      bringToFront: "置於頂層",
      bringForward: "上移一層",
      sendToBack: "置於底層",
      sendBackward: "下移一層",
      setLink: "設定連結",
      group: "組合",
      ungroup: "取消組合",
      lock: "鎖定",
      delete: "刪除"
    },
    vocational: {
      testFeature: "測試功能",
      vocationalTask: "職教任務",
      testFeatureTooltip: "從當前輸入框提交職教實操訓練測試"
    }
  }
};

// Default fallback for other languages (using English)
const defaultExtra = translations['en-US'];

const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));

files.forEach(file => {
  const code = file.replace('.json', '');
  const filePath = path.join(localesDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const extra = translations[code] || defaultExtra;
  data.canvas = extra.canvas;
  data.vocational = extra.vocational;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Updated ${file}`);
});

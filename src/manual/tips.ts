/** Hover manual. Reads the screen as it is; it does not own any app state. */

export type Tip = { title: string; text: string }

function text(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function has(el: Element, part: string): boolean {
  return text(el).toLocaleLowerCase('tr').includes(part.toLocaleLowerCase('tr'))
}

const KIND: Record<string, Tip> = {
  start: {
    title: 'Başlangıç',
    text: 'Akış her çalıştırmada buradan girer. Bundan sonrasını oklarla birbirine bağla.',
  },
  click: {
    title: 'Tıkla',
    text: 'Ekranda yazdığın yeri arar ve tıklar. Chrome 9222 ile açıksa önce sayfanın kendi yazısına bakar. Tırnak içindeki yazı birebir aranır. Sağındaki sarı nokta bir sonraki adıma gider.',
  },
  type: {
    title: 'Yazı Yaz',
    text: 'Bir alana yazar. Alan boş bırakılırsa o an seçili yere yazar. Döngüde sıradaki dosya için metne {{öğe}} yaz.',
  },
  key: {
    title: 'Tuş Gönder',
    text: 'Klavye kısayolu yollar. ^ Ctrl, % Alt, + Shift demektir. Örnek: ^s kaydeder, {ENTER} Enter’a basar.',
  },
  wait: {
    title: 'Zamanlayıcı',
    text: 'Yazdığın süre kadar bekler, sonra sonraki adıma geçer. Ekrana bakmaz; sadece saat sayar.',
  },
  condition: {
    title: 'Koşul',
    text: 'Ekranda bir yazı ya da seçtiğin öğe var mı diye bakar. Varsa “var”, yoksa “yok” çıkışından devam eder. Süre verirsen o süre boyunca tekrar tekrar bakar.',
  },
  loop: {
    title: 'Her Öğe İçin',
    text: 'Bir kutu. İçindeki adımlar listedeki her dosya için bir kez çalışır. Ajanı Çalıştır listenin başından başlar. Listedeki işaret, Seçiliden Çalıştır’ın hangi dosyadan devam edeceğini tutar. Kutu “bitti” deyince işaret 1. öğeye döner; sıradaki klasör baştan işlenir. Durdurulursa veya kutu hata diye kesilirse işaret o dosyada kalır. Sıradaki dosyanın yolu {{öğe}}, uzantısız adı {{öğe.isim}} olur. İş bitince akış “bitti” çıkışından çıkar.',
  },
  ai: {
    title: 'İnisiyatif',
    text: 'Birkaç adımlık işi tek cümleyle tarif edersin. Model ekrana bakıp tıklar, yazar, tuşa basar. Hedefe ulaşırsa “tamam”, ulaşamazsa “olmadı” çıkışından devam eder. Başarılı turun yolu kaydedilir; Hafızayı Sil bunu unutturur.',
  },
  browser: {
    title: 'Tarayıcıyı Aç',
    text: 'Bu adım kaldırıldı. Node’u silip akışa devam edebilirsin. Chrome’u kendin 9222 portuyla açarsan Tıkla ve Yazı Yaz sayfanın yazısını okur.',
  },
  waitFile: {
    title: 'Dosyayı Bekle',
    text: 'Bu adım kaldırıldı. Node’u silip akışa devam edebilirsin.',
  },
  moveFile: {
    title: 'Dosyayı Taşı',
    text: 'Bu adım kaldırıldı. Node’u silip akışa devam edebilirsin.',
  },
  end: {
    title: 'Bitir',
    text: 'Akış burada durur. Bundan sonraki node’lar çalışmaz.',
  },
  package: {
    title: 'Paket',
    text: 'Seçtiğin adımların tek node’a toplanmış hali. İçine girince o akışı düzenlersin. Çalışınca içi baştan sona gider, sonra dışarıdaki sonraki node çalışır.',
  },
  probe: {
    title: 'Kontrol',
    text: 'Akışı bozmaz. İçindeki {{öğe}}, {{öğe.isim}}, {{öğe.ad}}, {{sıra}} veya {{toplam}} düğmesine basınca, node’un durduğu kutudaki işaretli satırın değeri görünür. Çalışırken aynı değer günlüğe de yazılır.',
  },
}

const BY_LABEL: Record<string, string> = {
  Başlangıç: 'start',
  Tıkla: 'click',
  'Yazı Yaz': 'type',
  'Tuş Gönder': 'key',
  Zamanlayıcı: 'wait',
  Koşul: 'condition',
  'Her Öğe İçin': 'loop',
  İnisiyatif: 'ai',
  'Tarayıcıyı Aç': 'browser',
  'Dosyayı Bekle': 'waitFile',
  'Dosyayı Taşı': 'moveFile',
  Bitir: 'end',
  Paket: 'package',
  Kontrol: 'probe',
}

const PORT: Record<string, Tip> = {
  giriş: {
    title: 'Giriş',
    text: 'Akış bu adıma buradan girer. Başka bir çıkış noktasını sürükleyip bu noktaya bırak.',
  },
  sonra: {
    title: 'Sonra',
    text: 'Adım bitince akış buradan devam eder. Sarı noktayı sürükleyip sonraki node’un girişine bırak. Yanındaki + yeni bir node ekler ve onu bağlar.',
  },
  var: {
    title: 'Var',
    text: 'Aranan şey ekrandaysa akış bu çıkıştan gider.',
  },
  yok: {
    title: 'Yok',
    text: 'Aranan şey ekranda değilse akış bu çıkıştan gider. Süre tanındıysa ve bu çıkış boşsa, süre dolunca adım hata verir.',
  },
  bitti: {
    title: 'Bitti',
    text: 'Listedeki bütün öğeler işlenince akış kutunun dışına bu çıkıştan çıkar.',
  },
  geldi: {
    title: 'Geldi',
    text: 'Bu çıkış eski bir Dosyayı Bekle node’una ait. O adım artık atlanır ve akış buradan devam eder.',
  },
  'zaman aşımı': {
    title: 'Zaman aşımı',
    text: 'Bu çıkış eski bir Dosyayı Bekle node’una ait. O adım artık atlanır; bu çıkış kullanılmaz.',
  },
  tamam: {
    title: 'Tamam',
    text: 'İnisiyatif hedefe ulaştı. Akış bu çıkıştan gider.',
  },
  olmadı: {
    title: 'Olmadı',
    text: 'İnisiyatif hedefe ulaşamadı. Akış bu çıkıştan gider. Çıkış boşsa adım hata verir.',
  },
}

function kindOfNode(el: Element): string | null {
  for (const key of Object.keys(KIND)) if (el.classList.contains(`kind-${key}`)) return key
  return null
}

function portOf(el: Element): string | null {
  if (el.classList.contains('port-label')) return text(el).toLocaleLowerCase('tr')
  if (!el.classList.contains('node-port')) return null
  if (el.classList.contains('in')) return 'giriş'
  const row = el.closest('.port-row, .frame-out')
  const lab = row?.querySelector('.port-label')
  return lab ? text(lab).toLocaleLowerCase('tr') : 'sonra'
}

function fieldLabel(el: Element): string {
  const label = el.querySelector(':scope > label')
  return label ? text(label) : ''
}

function buttonTip(el: HTMLButtonElement): Tip | null {
  if (el.classList.contains('canvas-tab-add')) {
    return {
      title: 'Yeni tuval',
      text: 'Boş bir tuval açar. Her tuval ayrı bir akıştır. Ajan, o an açık olan tuvali çalıştırır. Çalışırken sekme değişmez.',
    }
  }
  if (el.classList.contains('canvas-tab-x')) {
    return {
      title: 'Tuvali kapat',
      text: 'Bu tuvali kapatır. İçinde adım varsa onay ister. Son tuval kapanmaz. Çalışırken kapanmaz.',
    }
  }
  const raw = text(el)
  const t = raw.replace(/^[^\p{L}\p{N}+]+/u, '').trim()
  const inMenu = !!el.closest('.dropdown-menu, .ctx-menu')
  const bold = el.querySelector('b')
  if (inMenu && bold) {
    const key = BY_LABEL[text(bold)]
    if (key) {
      const where = el.closest('.ctx-menu') ? 'Tıklayınca bu node buraya eklenir.' : 'Tıklayınca akışa bu node eklenir.'
      return { title: KIND[key].title, text: `${KIND[key].text} ${where}` }
    }
  }

  const exact: [string, Tip][] = [
    ['Paketle', { title: 'Paketle', text: 'Seçili node’ları tek bir Paket node’una alır. Bir döngünün içinden node seçtiysen kutu, bütün üyeleriyle birlikte pakete girer; kutu ortadan bölünmez.' }],
    ['İçine gir', { title: 'İçine gir', text: 'Paketin içindeki akışı tuvalde açar. Orada node ekleyip ok çekebilirsin. Sağ üstteki Paketten çık ile dışarı dönersin.' }],
    ['Paketi çıkar', { title: 'Paketi çıkar', text: 'Paketi dağıtır. İçindeki node’lar tuvale geri döner, paket node’u kalkar. Dışarıdaki oklar eski yerlerine bağlanır.' }],
    ['Paketten çık', { title: 'Paketten çık', text: 'İçeride yaptığın değişiklikleri pakete yazar ve dışarıdaki akışa döner. Paket yine tek node olarak durur.' }],
    ['Hafızayı Sil', { title: 'Hafızayı Sil', text: 'Açık tuvaldeki bütün hafızaları siler. Paketin içine girmiş olsan da o tuvalin kökü ve her paketin içi temizlenir. Diğer tuvaller durur. Akış, liste ve yazdığın adımlar durur.' }],
    ['Döngüleri Sıfırla', { title: 'Döngüleri Sıfırla', text: 'Açık tuvaldeki her Her Öğe İçin kutusunu 1. öğeye alır. Paketlerin içi de dahil. Önce dış kutu 1. öğeye gelir, sonra iç kutunun listesi o ilk öğenin klasöründen yeniden okunur. Diğer tuvaller durur.' }],
    ['Düzenle', { title: 'Düzenle', text: 'Node’ları soldan sağa, okların sırasına göre dizer. Bağlantıları değiştirmez.' }],
    ['Ajanı Çalıştır', { title: 'Ajanı Çalıştır', text: 'Açık tuvali Başlangıç’tan itibaren çalıştırır. Paketin içindeysen içi bittikten sonra dışarıdaki sonraki adımdan devam eder, en dıştaki Bitir’e kadar. Tuvaldeki her kutunun işareti 1. öğeye döner; açık paketin dışındaki kutular da. Diğer tuvaller durur. Çalışırken pencere küçülür. Durdurmak için Ctrl+Shift+Q.' }],
    ['Seçiliden Çalıştır', { title: 'Seçiliden Çalıştır', text: 'Akışı seçili node’dan başlatır. Kutular, listedeki işaretli satırdan devam eder; paket içindeki kutular da. Paketin içinde başlasan da akış paketin sonunda durmaz; dışarıdaki sonraki adımdan ve kutuların bitti çıkışından en dıştaki Bitir’e kadar gider. Bir kutu “bitti” dediyse işareti 1. öğededir, sıradaki klasör baştan gider. Yarıda duran kutunun işareti o dosyada kalır. Ajanı Çalıştır hepsini 1. öğeden başlatır.' }],
    ['Durdur', { title: 'Durdur', text: 'Çalışan akışı durdurur. Ctrl+Shift+Q ile de durur. Bekleyen model isteği de kesilir.' }],
    ['Dışa Aktar', { title: 'Dışa Aktar', text: 'Açık tuvalin akışını bir JSON dosyası olarak indirir. Dosya adı tuvalin adıdır. Diğer tuvaller bu dosyaya yazılmaz. Paketin içindeyken de paketin tamamı, yani tuvalin kendisi iner.' }],
    ['İçe Aktar', { title: 'İçe Aktar', text: 'Bir JSON akışını açık tuvale yükler. Bu tuvalin eski akışının yerini alır. Diğer tuvaller durur.' }],
    ['Ekrandan Seç', { title: 'Ekrandan Seç', text: 'Ekranın görüntüsünü açar. Bir yazının veya öğenin üzerine tıklayınca o hedef bu node’a bağlanır.' }],
    ['Ekranı Tara', { title: 'Ekranı Tara', text: 'Ekranı yeniden okur. Penceredeki yazılar ve uygulama öğeleri kutularla işaretlenir.' }],
    ['Günlük klasörü', { title: 'Günlük klasörü', text: 'Bu sürümün günlük klasörünü açar. Klasör, sürüm açılınca kendiliğinden oluşur: logs altında 1.7.38 gibi ayrı bir ad. Hata anının ekran görüntüsü de oraya yazılır.' }],
    ['Bağlantıyı Sil (Del)', { title: 'Bağlantıyı Sil', text: 'Seçili oku kaldırır. İki node durur, sadece aralarındaki bağ gider. Del tuşu da aynısını yapar.' }],
    ['Node’u Sil (Del)', { title: 'Node’u Sil', text: 'Seçili node’u akıştan çıkarır. Del tuşu da aynısını yapar.' }],
    ['Kutuyu Sil (içindekiler kalır)', { title: 'Kutuyu Sil', text: 'Her Öğe İçin çerçevesini kaldırır. İçindeki node’lar tuvalde kalır, sadece kutu dağılır.' }],
    ['Listeyi temizle', { title: 'Listeyi temizle', text: 'Klasör kutusunu ve öğe listesini boşaltır. İçindeki node’lar durur. Liste boşken kutu, aşağıdaki tekrar sayısı kadar döner.' }],
    ['Klasörden doldur…', { title: 'Klasörden doldur', text: 'Bir klasör seçersin; yolu üstteki kutuya yazılır. O klasörün içindeki her şey (dosya ve klasör) listeye birer satır olur. Alt klasörlerin içi açılmaz. Kutuya {{öğe}} yazarsan yol, bir dıştaki Her Öğe İçin’in öğesidir; paket bunu kesmez.' }],
    ['Model listesini getir', { title: 'Model listesini getir', text: 'OpenRouter’daki model adlarını indirir. Anahtar kayıtlı olmalı. Liste gelince model kutusunda seçebilirsin.' }],
    ['+ Yedek', { title: 'Yedek model', text: 'Bu kutunun modeline bir yedek ekler. Çalışırken 1 olmazsa 2, o da olmazsa 3 denenir. Beşi de susarsa sıra 1’e döner ve bırakmaz. En fazla beş model. Kaydet’e basınca kalır. Anahtar veya bakiye hatasında dönmez.' }],
    ['API Test', { title: 'API Test', text: 'Kayıtlı OpenRouter anahtarının çalışıp çalışmadığına bakar. Günlüğe sonucu yazar.' }],
    ['Görsel Test (ekranı anlat)', { title: 'Görsel Test', text: 'Ekranın bir karesini görsel modele gönderir. Model ne gördüğünü günlüğe yazar. Anahtar ve görsel model kayıtlı olmalı.' }],
    ['Tümünü Kaydet', { title: 'Tümünü Kaydet', text: 'Ayarlar sekmesindeki bütün alanları birden kaydeder. Tek bir alanın yanındaki Kaydet yalnızca o alanı yazar.' }],
    ['Unut', { title: 'Unut', text: 'Yalnızca bu node’un hafızasını veya kayıtlı yolunu siler. Diğer node’lar hatırlar. Hepsi için araç çubuğundaki Hafızayı Sil.' }],
  ]
  for (const [name, tip] of exact) {
    if (t === name || t.startsWith(name)) return tip
  }

  if (t === 'Kaydet' || t.startsWith('Kaydet')) {
    const label = el.closest('.field')?.querySelector('label')
    const what = label ? text(label) : 'bu ayar'
    return { title: 'Kaydet', text: `“${what}” değerini kalıcı olarak yazar. Kutuya yazmak tek başına yetmez.` }
  }
  if (t === 'Temizle' && el.closest('.bottom-panel')) {
    return { title: 'Günlüğü temizle', text: 'Ekrandaki ajan günlüğünü boşaltır. Diske yazılmış günlük dosyaları durur.' }
  }
  if (t === 'Temizle' && el.closest('.locator-box')) {
    return { title: 'Hedefi kaldır', text: 'Bu node’a Ekrandan Seç veya İmleçle Yakala ile bağlanan öğeyi unutturur. Ne aranacağı yine yazdığın metinden bulunur.' }
  }
  if (t === 'Dosya' && el.closest('.menubar')) {
    return { title: 'Dosya', text: 'İçe Aktar ve Dışa Aktar burada. İçe Aktar açık tuvale bir JSON yükler. Dışa Aktar yalnız açık tuvali indirir.' }
  }
  if (t === 'Ayarlar' && el.closest('.menubar')) {
    return { title: 'Ayarlar', text: 'Sağ paneli Ayarlar sekmesine alır: API anahtarı, modeller, hedef pencere.' }
  }
  if (t === 'Ayarlar' && el.classList.contains('tab')) {
    return { title: 'Ayarlar sekmesi', text: 'API anahtarı, modeller ve çalışma ayarları. Node’un kendi ayarları için Node sekmesine dön.' }
  }
  if (t === 'Ekran Tarayıcı' && el.closest('.menubar')) {
    return { title: 'Ekran Tarayıcı', text: 'Ekrandaki yazıları ve öğeleri açar. Birine tıklayınca yeni bir Tıkla node’u oluşur.' }
  }
  if (t === 'Ekran Tarayıcı' && el.closest('.toolbar')) {
    return { title: 'Ekran Tarayıcı', text: 'Ekrandaki yazıları ve öğeleri açar. Birine tıklayınca akışa bir Tıkla node’u eklenir.' }
  }
  if (t.startsWith('İmleçle Yakala') || t.startsWith('İmleci hedefe götür')) {
    return {
      title: 'İmleçle Yakala',
      text: 'Üç saniye verir. İmleci hedefin üzerine götür; süre bitince imlecin altındaki öğe (ve varsa küçük resmi) node’a bağlanır.',
    }
  }
  if (t.includes('Node Ekle')) {
    return { title: 'Node Ekle', text: 'Listeyi açar. Seçtiğin tür, seçili bir node varsa ondan sonraya, yoksa akışın sonuna eklenir.' }
  }
  if (el.classList.contains('tab') && (t === 'Node' || t === 'Bağlantı')) {
    return { title: t === 'Bağlantı' ? 'Bağlantı' : 'Node sekmesi', text: 'Seçili node’un veya okun ayarları burada. Tuvalde bir şeye tıklayınca bu sekme onu gösterir.' }
  }
  if (t.includes('Buradan çalıştır')) {
    return { title: 'Buradan çalıştır', text: 'Akışı bu node’dan başlatır. Önceki adımlar atlanır.' }
  }
  if (t.includes('kutuya al')) {
    return { title: 'Kutuya al', text: 'Seçili node’ları yeni bir Her Öğe İçin kutusuna koyar. Ctrl+G ile de olur. Kutu, listedeki her öğe için içindekileri baştan çalıştırır.' }
  }
  if (t.startsWith('Kutudan çıkar')) {
    return { title: 'Kutudan çıkar', text: 'Node kutunun içinde kalmaz, bir üst seviyeye çıkar. Akıştaki yeri durur.' }
  }
  if (t === 'Kopyala') {
    return { title: 'Kopyala', text: 'Node’un bir kopyasını yanına koyar. Kutu kopyalanırsa içi boş gelir. Ctrl+D ile de olur.' }
  }
  if (t.startsWith('Bağla')) {
    return { title: 'Bağla', text: 'Bu node’un çıkışını seçer. Sonra bağlamak istediğin node’a tıkla.' }
  }
  if (el.closest('.ctx-menu') && (t === 'Sil' || t.startsWith('Kutuyu sil'))) {
    return { title: 'Sil', text: 'Seçili node’u kaldırır. Kutu silinirse içindeki node’lar tuvalde kalır.' }
  }
  if (el.classList.contains('seg-btn')) return segTip(t)
  if (el.classList.contains('chip') && el.classList.contains('var')) return varTip(raw)
  if (el.classList.contains('chip')) {
    return { title: t, text: 'Hazır değer. Tıklayınca üstteki alana bunu yazar. Kaydet isteyen ayarlarda ayrıca Kaydet’e bas.' }
  }
  if (el.classList.contains('add-next') || t === '+') {
    return { title: 'İleriye ekle', text: 'Bu çıkışın ardına yeni bir node ekler ve oku ona bağlar.' }
  }
  if (el.classList.contains('shot-box') || el.classList.contains('scan-row')) {
    return { title: 'Ekrandaki öğe', text: 'Tıklayınca bu öğe hedef olur. Mavi, uygulamanın bildirdiği öğedir. Turuncu, ekrandan okunan yazıdır (OCR).' }
  }
  if (el.classList.contains('link-btn')) {
    return { title: text(el) || 'Bağlantı', text: 'İlgili ayara gider. Akışı çalıştırmaz.' }
  }
  if (el.classList.contains('title-btn')) {
    if (el.closest('.xp-dialog')) return { title: 'Kapat', text: 'Ekran tarayıcıyı kapatır. Esc de kapatır.' }
    if (el.classList.contains('close')) return { title: 'Kapat', text: 'Programı kapatır.' }
    if (raw === '_') return { title: 'Küçült', text: 'Pencereyi görev çubuğuna indirir.' }
    return { title: 'Büyüt', text: 'Pencereyi büyütür veya eski boyutuna döner. Başlık çubuğuna çift tıklamak da aynısını yapar.' }
  }
  return null
}

function varTip(raw: string): Tip {
  const key = raw.replace(/\s+/g, '')
  const tips: Record<string, Tip> = {
    '{{öğe}}': {
      title: '{{öğe}}',
      text: 'Bu turdaki satırın tamamı. Liste dosya yoluysa tam yoldur: ilk tur C:\\Resimler\\kedi.png, ikinci tur C:\\Resimler\\köpek.png. Yazı Yaz’a yalnızca bunu yazarsan her tur sıradaki dosya gider. Tıklayınca üstteki alanın sonuna eklenir.',
    },
    '{{öğe.ad}}': {
      title: '{{öğe.ad}}',
      text: 'Bu turdaki dosyanın adı, uzantısıyla. kedi.png satırında “kedi.png” olur, yolun geri kalanı gelmez. Tıklayınca üstteki alanın sonuna eklenir.',
    },
    '{{öğe.isim}}': {
      title: '{{öğe.isim}}',
      text: 'Bu turdaki dosyanın uzantısız adı. kedi.png → kedi. İnen modeli D:\\Modeller\\{{öğe.isim}}.glb diye kaydedersen dosya kedi.glb olur. Tıklayınca üstteki alanın sonuna eklenir.',
    },
    '{{sıra}}': {
      title: '{{sıra}}',
      text: 'Kaçıncı tur olduğu. İlk öğe 1, ikinci öğe 2. Liste boşken kutu N kez dönüyorsa da 1’den başlayıp artar. Tıklayınca üstteki alanın sonuna eklenir.',
    },
    '{{toplam}}': {
      title: '{{toplam}}',
      text: 'Listede kaç öğe olduğu. İki dosya varsa her turda 2’dir. “{{sıra}} / {{toplam}}” yazarsan 1 / 2, sonra 2 / 2 olur. Tıklayınca üstteki alanın sonuna eklenir.',
    },
  }
  return (
    tips[key] ?? {
      title: raw,
      text: 'Bu turda yerine gerçek değer yazılır. Tıklayınca üstteki alanın sonuna eklenir.',
    }
  )
}

function segTip(t: string): Tip | null {
  const map: Record<string, Tip> = {
    'Tek tık': { title: 'Tek tık', text: 'Sol tuşla bir kez tıklar.' },
    'Çift tık': { title: 'Çift tık', text: 'Çift tıklar. Masaüstü simgeleri ve dosyalar genelde bunu ister.' },
    'Sağ tık': { title: 'Sağ tık', text: 'Sağ tıklar. Menü açmak için.' },
    'Ekrana bakarak (UI-TARS gibi)': {
      title: 'Ekrana bakarak',
      text: 'İnisiyatif her adımda ekran görüntüsü alır ve tıklanacak noktayı modelden ister. Yazısız ikon ve menülerde bu yol kullanılır.',
    },
    'Yazı listesiyle': {
      title: 'Yazı listesiyle',
      text: 'Ekrandaki yazılar numaralanır, model numarayı seçer. Formlar ve web sayfalarında hızlıdır. İkonu göremez.',
    },
  }
  return map[t] ?? null
}

function fieldTip(el: Element): Tip | null {
  if (!el.classList.contains('field')) return null
  const label = fieldLabel(el)
  const legend = el.closest('fieldset')?.querySelector('legend')
  const group = legend ? text(legend) : ''
  const tips: [string, Tip][] = [
    ['Liste (her satır bir öğe)', { title: 'Liste', text: 'Her satır bir turdur. Soldaki işaret, Seçiliden Çalıştır’ın başlayacağı satırdır; tek satır işaretli olur. Ajanı Çalıştır her zaman birinci satırdan başlar. Çalışırken işaret turdaki dosyaya kayar. Kutu bitince işaret 1. satıra döner. Yarıda kesilirse o satırda kalır. Yükleme adımına {{öğe}} yaz; o, satırdaki tam yoldur.' }],
    ['Tekrar sayısı', { title: 'Tekrar sayısı', text: 'Liste boşken kutu bu kadar kez döner. {{öğe}} o turda 1, 2, 3 diye gider.' }],
    ['Nasıl çalışsın?', { title: 'Nasıl çalışsın?', text: 'Ekrana bakarak: model görüntüden tıklar. Yazı listesiyle: ekrandaki yazılardan numara seçer.' }],
    ['Hedef (ne olmasını istiyorsun?)', { title: 'Hedef', text: 'İnisiyatif’in yapacağı iş. Birkaç adımı tek cümlede yaz. {{öğe}} yazarsan her tur o dosyaya göre değişir; kayıtlı yol o zaman oynatılmaz, model yeniden bakar.' }],
    ['En fazla eylem', { title: 'En fazla eylem', text: 'İnisiyatif bu kadar tıklama, yazma ve tuştan sonra durur. Hedefe varmadan sınır dolarsa “olmadı” sayılır.' }],
    ['Neye tıklanacak?', { title: 'Neye tıklanacak?', text: 'Ekranda gördüğün yazıyı yaz. Tırnak içine alırsan birebir aranır. {{öğe.ad}} o turdaki dosya adıdır.' }],
    ['Tıklama türü', { title: 'Tıklama türü', text: 'Tek tık, çift tık veya sağ tık. Simgeler çoğunlukla çift tık ister.' }],
    ['Yazılacak metin', { title: 'Yazılacak metin', text: 'Alana yazılacak şey. Sıradaki dosya için yalnızca {{öğe}} yaz. Sabit bir dosya adı yazarsan her tur aynı dosya gider.' }],
    ['Hangi alana?', { title: 'Hangi alana?', text: 'Yazının gideceği yer. Boşsa o an odaklanan alana yazar. Doluysa önce o yazıyı ekranda bulup oraya tıklar.' }],
    ['Tuş (SendKeys biçimi)', { title: 'Tuş', text: '^ Ctrl, % Alt, + Shift. Alttaki hazır düğmeler sık kullanılanları doldurur. {{öğe}} bu alanda da değişir.' }],
    ['Önce tıklanacak yer', { title: 'Önce tıklanacak yer', text: 'Tuş gitmeden önce modelin ekranda tıklayacağı yer. Odak yanlış penceredeyse tuş oraya gitmesin diye.' }],
    ['Süre (saniye)', { title: 'Süre', text: 'Zamanlayıcının bekleyeceği saniye. Ekrana bakılmaz.' }],
    ['Ekranda aranacak yazı', { title: 'Aranacak yazı', text: 'Koşul bu yazıyı ekranda arar. Ekranda gerçekten görünen yazıyı yaz. Öğenin iç adındaki caret-down gibi ekler ekranda yoktur, onları yazma.' }],
    ['Ekranda ne görünmeli?', { title: 'Ekranda ne görünmeli?', text: 'Görsel modele sorulacak tarif. Önce yazı ve seçilen öğe aranır; bulunamazsa bu tarif modele gider.' }],
    ['Görünene kadar bekle', { title: 'Görünene kadar bekle', text: '0 ise bir kez bakar. Süre verirsen o kadar saniye boyunca tekrar tekrar bakar. Süre dolunca “yok” çıkışı kullanılır.' }],
    ['Başlık', { title: 'Başlık', text: 'Node’un tuvalde görünen adı. Akışın çalışmasını değiştirmez; günlüğe bu ad yazılır.' }],
    ['OpenRouter API Key', { title: 'API anahtarı', text: 'OpenRouter anahtarın. Modelin ekranı okuması ve İnisiyatif için gerekir. Yanındaki Kaydet’e basınca kalır.' }],
    ['Görsel model adı', { title: 'Görsel model', text: 'Tepki, takılma ve İnisiyatif’in “bitti mi” kontrolü bu modele bakar. Tıklamayı UI-TARS yapar.' }],
    ['Hedef pencere', { title: 'Hedef pencere', text: 'Doluysa yalnızca o pencere okunur ve öne alınır. “Tüm ekran” masaüstü dahil her yere bakar. ↻ listeyi yeniler.' }],
    ['Adımlar arası bekleme', { title: 'Adımlar arası bekleme', text: 'Her adımdan sonra bu kadar milisaniye durur. Sayfanın yerleşmesi için. 800 makul bir başlangıçtır.' }],
    ['Maks. adım', { title: 'Maks. adım', text: 'Bir turda bu kadar adımdan fazla çalışılırsa tur durur. Hiç bitmeyen bir bekleme döngüsüne karşı. Kutunun her turu ayrı sayılır.' }],
  ]
  if (label === 'Model adı' && group.includes('İnisiyatif')) {
    return { title: 'İnisiyatif modeli', text: 'Ekrana bakarak çalışan İnisiyatif bu modeli kullanır. Varsayılan UI-TARS’tır. Aynı OpenRouter anahtarı geçerli. Kaydet’e bas.' }
  }
  if (label === 'Model adı') {
    return { title: 'Model adı', text: 'Yazı listesinden seçim yapan modeller. 1 önce denenir, olmazsa alttakiler. Listenin altındaki Kaydet’e basınca kalır.' }
  }
  for (const [name, tip] of tips) if (label.startsWith(name)) return tip
  if (label) return { title: label, text: 'Bu alan seçili node’un veya ayarın değeridir. Değişiklik, Kaydet düğmesi olanlarda Kaydet’e basınca kalır.' }
  return null
}

function checkTip(el: Element): Tip | null {
  if (!el.classList.contains('check')) return null
  const t = text(el)
  if (t.includes('Pakette ayarları göster')) return { title: 'Pakette ayarları göster', text: 'İşaretliyse bu node’un ayarları, içinde durduğu pakete tıklayınca sağda açılır. Her Öğe İçin kutuları o listede en üstte durur.' }
  if (t.includes('Önce alandaki yazıyı sil')) return { title: 'Önce sil', text: 'Yazmadan önce alanın içini temizler. Odak bir yazı alanı değilse Ctrl+A gönderilmez, sadece yazılır.' }
  if (t.includes('Enter')) return { title: 'Enter’a bas', text: 'Yazı gittikten sonra Enter yollar. Dosya penceresinde bu, seçilen dosyayı açar.' }
  if (t.includes('numaralı ekran görüntüsü')) return { title: 'Numaralı ekran görüntüsü', text: 'Açıksa yazı seçen modele ekranın numaralı bir karesi de gider. Kapalıysa model yalnızca yazı listesini görür.' }
  if (t.includes('küçült')) return { title: 'Çalışırken küçült', text: 'Ajan çalışırken bu pencere küçülür, böylece ekran görüntüsüne girip kendine tıklamaz. Durdurmak için Ctrl+Shift+Q.' }
  return { title: 'Seçenek', text: t }
}

function regionTip(el: Element): Tip | null {
  if (el.classList.contains('canvas-tab') || el.classList.contains('canvas-tabs') || el.classList.contains('canvas-tab-rename')) {
    return {
      title: 'Tuval sekmesi',
      text: 'Her sekme ayrı bir akıştır. Ajan açık olanı çalıştırır. Çift tıklayınca adını değiştirirsin. Ctrl+A tuvaldeki her node’u seçer. Ctrl+C kopyalar, Ctrl+X keser, Ctrl+V yapıştırır. İki seçili node’un arasındaki ok durur; seçimin dışına çıkan ok kopar. Kopya başka bir tuvale ya da bir paketin içine de yapışır.',
    }
  }
  if (el.classList.contains('ocr-pick') || el.classList.contains('ocr-opt')) {
    return {
      title: 'OCR',
      text: 'Ekrandaki yazıyı hangi okuyucu versin. Windows: sistemin okuyucusu, ONNX yalnızca Çince ve kaçan İngilizceyi ekler. ONNX: ekran yazısı yalnızca ondan gelir; Windows’un Çinceye uydurduğu satır kullanılmaz. Uygulamanın kendi bildirdiği isimler iki seçenekte de durur. Yan duran yazı, önizleme kopyalandıktan sonra ayrı bir kareden okunur. Düz okumada kutusu olan satır tekrar eklenmez.',
    }
  }
  const kind = kindOfNode(el)
  if (kind && KIND[kind]) return KIND[kind]
  const port = portOf(el)
  if (port && PORT[port]) return PORT[port]
  if (el.classList.contains('add-next')) return { title: 'İleriye ekle', text: 'Bu çıkışın ardına yeni bir node ekler ve oku ona bağlar.' }
  if (el.classList.contains('edge-hit') || el.classList.contains('edge')) {
    return { title: 'Bağlantı', text: 'Akış bu oktan gider. Tıklayınca seçilir. Del veya sağ paneldeki Bağlantıyı Sil ile kalkar.' }
  }
  if (el.classList.contains('loop-frame-head') || el.classList.contains('frame-title')) {
    return { title: 'Kutu başlığı', text: 'Buradan tutup kutuyu içindekilerle birlikte taşırsın. Sağ tık: kutuya alma, çıkarma, silme. Silmek içindekileri silmez.' }
  }
  if (el.classList.contains('frame-empty')) {
    return { title: 'Boş kutu', text: 'Tekrar edecek node’ları çerçevenin içine sürükle. Ya da node’ları seçip Ctrl+G.' }
  }
  if (el.classList.contains('frame-sub')) {
    return { title: 'Sıradaki öğe', text: 'Kutu çalışırken o an hangi dosyada olduğunu gösterir.' }
  }
  if (el.classList.contains('loop-frame')) {
    return KIND.loop
  }
  if (el.classList.contains('node-meta')) {
    return { title: 'Hafıza', text: 'Bu node’un geçen turlarda işe yarayan hedefi veya kayıtlı yolu. Her tur yine yeniden aranır. Silmek için node’un içindeki Unut ya da araç çubuğundaki Hafızayı Sil.' }
  }
  if (el.classList.contains('node-summary')) {
    return { title: 'Özet', text: 'Bu node’un ne yapacağının kısa hali. Değiştirmek için node’a tıkla; ayarlar sağda açılır.' }
  }
  if (el.classList.contains('status-chip')) {
    return { title: 'Durum', text: 'Bu adım şu an çalışıyor, bitti veya hata verdi. Yalnızca bu çalıştırmayı gösterir.' }
  }
  if (el.classList.contains('icon-thumb') || el.classList.contains('icon-preview')) {
    return { title: 'Öğenin resmi', text: 'Ekrandan Seç ile alınan küçük resim. Yazı bulunamazsa ajan ekranda bu resmin aynısını arar.' }
  }
  if (el.classList.contains('canvas-zoom')) {
    return { title: 'Yakınlık', text: 'Tekerlek yakınlaştırır ve uzaklaştırır. Orta tuşla sürüklemek tuvali kaydırır. Bu düğme %100’e döner.' }
  }
  if (el.classList.contains('empty-canvas')) {
    return { title: 'Boş tuval', text: 'Sağ tıkla veya Node Ekle ile ilk adımı koy. Node’ları oklarla bağla. Her Öğe İçin kutusuna sürüklenen node, listedeki her dosya için tekrar eder.' }
  }
  if (el.classList.contains('canvas-scroll') || el.classList.contains('canvas-inner')) {
    return { title: 'Tuval', text: 'Akışın durduğu yer. Boş yere sağ tıkla, node ekle. Ctrl+A hepsini seçer. Ctrl+C kopyalar, Ctrl+X keser, Ctrl+V yapıştırır; ok, yalnızca iki ucu da seçiliyse durur. Tekerlek yakınlaştırır, orta tuş kaydırır. Boş yerde sürüklemek kutu çizerek seçer. Shift ile tıklamak, ya da Shift basılıyken yeni bir kutu çizmek, seçime ekler. Node’u bir çerçevenin içine bırakınca o kutuya girer, dışına bırakınca çıkar.' }
  }
  if (el.classList.contains('hint-block') || el.classList.contains('hint-list')) {
    return { title: 'Nasıl kullanılır', text: 'Henüz bir node seçilmedi. Tuvalde bir node’a tıklayınca onun ayarları burada açılır. Soldaki liste de aynı işi anlatır.' }
  }
  if (el.classList.contains('inspector-kind')) {
    return { title: text(el) || 'Node', text: 'Seçili node’un türü. Alttaki alanlar bu türe göredir. Türü değiştirmek için tuvalde başka bir node seç.' }
  }
  if (el.classList.contains('memo-box')) {
    return { title: 'Kayıt', text: 'Bu node’un hatırladığı hedef veya başarılı tur. Unut yalnızca bunu siler.' }
  }
  if (el.classList.contains('xp-tick') || el.classList.contains('xp-tick-row') || el.classList.contains('xp-tick-list')) {
    return {
      title: 'Liste işareti',
      text: 'Tek satır işaretlenir. Seçiliden Çalıştır listeyi bu satırdan sona kadar götürür. Ajanı Çalıştır birinci satırdan başlar. Çalışırken işaret, o anki turun dosyasına kayar. Kutu bitince işaret 1. satıra döner. Yarıda kesilirse o satırda kalır.',
    }
  }
  if (el.classList.contains('var-chips')) {
    return {
      title: 'Değişkenler',
      text: 'Her düğme bu turda değişen bir değerdir. Üzerinde durunca ne olduğu yazılır. Tıklayınca üstteki alanın sonuna eklenir.',
    }
  }
  if (el.classList.contains('locator-box')) {
    return { title: 'Hedef', text: 'Ekrandan Seç veya İmleçle Yakala ile bağlanan öğe. Çalışırken önce bu öğe, sonra resmi, sonra yazı aranır.' }
  }
  if (el.classList.contains('log-line')) {
    return { title: 'Günlük satırı', text: 'Ajanın o anda ne yaptığı. Mavi bilgi, yeşil başarı, kırmızı hata. API’ye giden ve gelen yazılar da burada görünür.' }
  }
  if (el.classList.contains('log-body') || el.classList.contains('bottom-panel') || el.classList.contains('panel-header')) {
    return { title: 'Ajan günlüğü', text: 'Çalışmanın adım adım dökümü. Hangi turda hangi dosyanın yazıldığı burada belli olur. Günlük klasörü, aynı dökümün dosyalarını açar.' }
  }
  if (el.classList.contains('menubar-status')) {
    return { title: 'Durum', text: 'Kaç node ve bağlantı olduğu, hangi pencereye bakıldığı ve API anahtarının kayıtlı olup olmadığı.' }
  }
  if (el.classList.contains('menubar')) {
    return { title: 'Menü', text: 'Dosya menüsünden akış iner veya açılır. Ayarlar, sağ paneli Ayarlar sekmesine alır.' }
  }
  if (el.classList.contains('toolbar') && !el.closest('.xp-dialog')) {
    return { title: 'Araç çubuğu', text: 'Node ekleme, çalıştırma, durdurma ve hafızayı silme. Bir düğmenin üzerinde dur; ne yaptığı burada yazılır.' }
  }
  if (el.classList.contains('dropdown-menu') || el.classList.contains('ctx-menu')) {
    return { title: 'Menü', text: 'Bir satırın üzerinde dur. O node’un ne yaptığı açılır.' }
  }
  if (el.classList.contains('tabs')) {
    return { title: 'Sekmeler', text: 'Node: seçili adımın ayarları. Ayarlar: API anahtarı ve modeller.' }
  }
  if (el.classList.contains('side-panel') || el.classList.contains('panel-body')) {
    return { title: 'Sağ panel', text: 'Seçili node’un ayarları. Tuvalde bir node’a tıklayınca burası ona göre değişir. Bir alanın üzerinde durursan o alanın ne işe yaradığı yazılır.' }
  }
  if (el.classList.contains('settings-grid') || el.classList.contains('xp-group')) {
    return { title: text(el.querySelector('legend') ?? el) || 'Ayarlar', text: 'Bu ayarlar Kaydet ile kalır. Kutuya yazıp Kaydet’e basmazsan bir sonraki açılışta eski değer durur.' }
  }
  if (el.classList.contains('titlebar') && !el.closest('.xp-dialog')) {
    return { title: 'Başlık çubuğu', text: 'Pencereyi buradan taşırsın. Çift tık büyütür. Sağdaki düğmeler küçült, büyüt ve kapatır.' }
  }
  if (el.classList.contains('dialog-title')) {
    return { title: 'Ekran Tarayıcı', text: 'Ekrandaki yazıları gösterir. Bir kutuya tıklayınca o öğe node’a bağlanır. Esc kapatır.' }
  }
  if (el.classList.contains('scanner-shot') || el.classList.contains('shot-wrap')) {
    return { title: 'Ekran görüntüsü', text: 'Renkli kutular bulunan öğelerdir. Birine tıklayınca hedef o olur.' }
  }
  if (el.classList.contains('scanner-list')) {
    return { title: 'Yazı listesi', text: 'Ekranda bulunan yazılar. Bir satıra tıklayınca o öğe seçilir. Üstteki arama listeyi süzer.' }
  }
  if (el.classList.contains('scanner') || el.classList.contains('xp-dialog')) {
    return { title: 'Ekran Tarayıcı', text: 'Ekranı okur. Bir öğeye tıklayınca o, seçili node’un hedefi olur veya yeni bir Tıkla node’u açar.' }
  }
  if (el.classList.contains('modal-backdrop')) {
    return { title: 'Kapat', text: 'Tarayıcının dışına tıklamak pencereyi kapatır.' }
  }
  if (el.classList.contains('search') || (el instanceof HTMLInputElement && el.placeholder.includes('Yazı ara'))) {
    return { title: 'Yazı ara', text: 'Listedeki yazıları süzer. Ekrandaki kutular da buna göre azalır.' }
  }
  if (el.classList.contains('scope')) {
    return { title: 'Hangi pencere', text: 'Tüm ekran ya da listeden bir pencere. Seçince Ekranı Tara’ya yeniden bas.' }
  }
  if (el.classList.contains('source')) {
    return { title: 'Kaynak', text: 'Hepsi, yalnızca uygulamanın bildirdiği öğeler, ya da yalnızca OCR ile okunan yazılar.' }
  }
  if (el.classList.contains('dialog-status')) {
    return { title: 'Nasıl seçilir', text: 'Görüntüdeki bir kutuya veya sağdaki bir satıra tıkla. Mavi uygulama öğesi, turuncu OCR yazısıdır.' }
  }
  return null
}

/** The innermost element that has something to say. */
export function findTip(start: EventTarget | null): { el: Element; tip: Tip } | null {
  if (!(start instanceof Element)) return null
  if (start.closest('.xpas-manual')) return null
  let el: Element | null = start
  while (el && el !== document.documentElement) {
    const tip =
      (el instanceof HTMLButtonElement ? buttonTip(el) : null) ||
      fieldTip(el) ||
      checkTip(el) ||
      regionTip(el)
    if (tip) return { el, tip }
    el = el.parentElement
  }
  return null
}

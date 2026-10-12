import type { NodeKind } from './graph-types'

/** Only node kinds actually supported by the runner. Legacy retired kinds are not methods. */
export const METHOD_TABS: { id: NodeKind; title: string; note: string }[] = [
  { id: 'click', title: 'Tıkla', note: 'Hedef arama sırası ve ortak promptlar Yazı Yaz ile paylaşılır. Aşağıdaki değişiklikler ikisini de etkiler.' },
  { id: 'condition', title: 'Koşul', note: 'Kutuya ne aradığını düz cümleyle yazarsın; kararı metin modeli verir. Bir turda önce uygulama öğeleri (UIA), açık kanıt yoksa birleşik Windows + ONNX OCR okunur ve her iki aşamada da model karar verir. Boş listeler de modele gönderilir. İlk doğrulanan koşulda durur; kendi içinde bekleme veya tekrar yoktur. Tekrar için Zamanlayıcı ile döngü kur. Pencere alanı yalnız model bağlamıdır. Tıklama, odak değiştirme, görsel arama veya Tıkla’nın kurtarma döngüsü yok.' },
  { id: 'type', title: 'Yazı Yaz', note: 'Hedef tarifi veya seçilmiş öğe varsa Tıkla ile ortak arama kullanılır. Yoksa odaktaki yere doğrudan yazılır. Aşağıdaki ortak ayarlar Tıkla’yı da etkiler.' },
  { id: 'ai', title: 'Yap', note: 'Görev ve tuval bağlamı araç çağıran modele gönderilir. Eski İnisiyatif liste/görsel promptları bu node’da kullanılmaz.' },
  { id: 'key', title: 'Tuş Gönder', note: 'Node’daki tuş dizisi doğrudan Windows köprüsüne gönderilir. LLM ve hedef arama promptu yok.' },
  { id: 'wait', title: 'Zamanlayıcı', note: 'Node’daki süre boyunca durdurulabilir bekleme yapar. LLM yok.' },
  { id: 'loop', title: 'Her Öğe İçin', note: 'Sayı, liste veya klasörden gelen öğelerle üye node’ları çalıştırır. Sayaç ve değişkenler motor tarafından yürütülür; kendi LLM çağrısı yok.' },
  { id: 'package', title: 'Paket', note: 'İçindeki akışı çalıştırır. Kendi LLM çağrısı yok; alt node’ların yöntemleri geçerlidir.' },
  { id: 'start', title: 'Başlangıç', note: 'Akışın başlangıç noktasını belirtir. LLM veya ekran okuma yok.' },
  { id: 'end', title: 'Bitir', note: 'İlgili akış yolunu sonlandırır. LLM veya ekran okuma yok.' },
]

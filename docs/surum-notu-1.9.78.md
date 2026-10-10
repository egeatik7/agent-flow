# Sürüm notu — 1.9.78 (“Metin Modeli” kutusu + OpenRouter bölümündeki açıklama yazılarının temizliği)

Kullanıcının onayı ✓: *"okey böyle yap, openrouter kısmında gereksiz yazıları falan sil, metin modeli kutusuna al ama bozma genel yapıyı"* ✓.
**Bu sürüm SADECE ARAYÜZDÜR** ✓ — motor (runner/agent/worker), istek yolu ve ayar şeması **değişmedi** ✗.

## Gelen
- **En üstteki model alanı artık “Metin Modeli” kutusunda** ✓: `<fieldset className="xp-group"><legend>Metin Modeli</legend>` ✓ —
  diğer iki kutu (**Görsel LLM** ✓, **İnisiyatif modeli** ✓) **zaten** aynı yapıda ✓ → **yerleşim ve genel yapı korundu** ✓.
- **Silinen/kısalan açıklama metinleri** ✓ (yalnız **açıklayan** metinler ✗):
  - *“Her ayarın yanındaki Kaydet ile kalıcı olarak saklanır.”* → **silindi** ✓
  - *“Listedeki 1. model önce denenir. Olmazsa 2, 3, 4, 5. Hepsi susarsa sıra başa döner. Durdurmak için Ctrl+Shift+Q.”* →
    **kısaltıldı** ✓: *“Listedeki 1. model önce denenir; yedekler sırayla. Hepsi susarsa sıra başa döner.”* ✓
  - **Görsel LLM** legendindeki 2 satırlık paragraf → **silindi** ✓ (modelin görsel olması gerektiğini **zaten uyarı satırı** söylüyor ✓)
  - **İnisiyatif modeli** legendindeki 3 satırlık paragraf → **silindi** ✓
  - `LlmPanel`'deki *“Hedef yukarıdan aşağı aranır…”* paragrafı → **silindi** ✓ (aşama **notları** ✓ ve **kutucuklar** ✓ kalıyor ✓)
- **Uyarılar KORUNDU** ✗ (bunlar süs değil, **karar** metni ✓): *“API anahtarı kayıtlı değil”* ✓ · *“Bu model ekran görüntüsünü göremez”* ✓ ·
  *“Görsel destekli model.”* ✓ · paneldeki **fiyat/destek çekincesi** ✓.
- **Sıralama altyapısı hazır** ✓: `ModelChain` **zaten** her satırda **↑ / ↓ / ×** taşıyor ✓ (yerel model eklendiğinde
  *“yerel modeli aşağı yukarı al”* ✓ **ek iş gerektirmeden** çalışacak ✓).

## Değişmeyen
Motor davranışı ✓ · istek yolu ✓ · **ayar şeması (yeni alan YOK)** ✓ · node/akış JSON'u ✓ · `ModelChain` işlevi ✓.

## Doğrulama
`typecheck` ✓ · `build:electron` ✓ · **Vitest 82 dosya / 592 test** ✓ · **beş npm paketi** ✓ ·
**sekiz Node regresyon 118/0** ✓ · **Windows PowerShell 5.1'de 10 harness** ✓ · `pack:win` ✓ · exe hash ✓.

## Sıradaki (onaylanmış plan ✓)
- **1.9.79** ✓: **yerel model** — **ayrı tuş** ✓ + **AYNI listede hem OpenRouter hem yerel** ✓ + adres/model formu ✓ +
  isteklerin yönlendirilmesi ✓ (**motor komşusu** ✗ — kullanıcının açık onayıyla ✓).
- **1.9.80** ✓: **Gelişmiş** — zaman aşımı ✓, görüntü beyanı ✓, “Şimdilik OpenRouter'a dön” ✓.

## Doğrulanmayan (dürüst ✗)
- **Canlı Windows denemesi yapılmadı** ✗ → kutunun **yerleşimi** ✓ ve **yazı temizliğinin** göze hoş gelmesi ✓ senin denemenle doğrulanmalı ✓.
- **Yeni jest için test yazılmadı** ✗ (saf JSX ✓) → yalnız tip kontrolü + derleme + mevcut paketler ✓.
import path from 'node:path'

/**
 * Kütüphane klasörünü SEÇER ama asla korumalı bir klasörü OLUŞTURMAZ.
 *
 * Ölçülen kusur (1.9.107): Windows Defender "Denetimli klasör erişimi" açıkken
 * `fs.mkdirSync("<Belgeler>\Nubbo\Kütüphane", { recursive: true })` **süresiz bekliyor** (hata bile
 * vermiyor), bu yüzden uygulama açılışta kütüphaneyi yüklerken "arayüz yükleniyor" adımında donuyordu.
 * Bu yüzden: yapılandırılmış yol her zaman kazanır; varsayılan Belgeler yolu **zaten varsa** kullanılır
 * (okumak güvenli), yoksa ve korumalı bir kökün altındaysa korumasız profil klasörüne düşülür.
 */
export type LibraryPathInput = {
  /** Kayıtlı ayar; boş değilse tartışmasız kullanılır. */
  configured: string
  documents: string
  home: string
  /** Aday klasör şu an var mı; çağıran taraf ölçer (bu modül dosyaya dokunmaz). */
  exists: (candidate: string) => boolean
  /** İşletim sisteminin yazmayı engelleyebileceği kökler (Belgeler, Masaüstü, Resimler, ...). */
  protectedRoots: string[]
}

export type LibraryPathChoice = { directory: string; fallback: boolean }

const normalize = (value: string): string => path.resolve(value).replace(/[\\/]+$/, '').toLowerCase()

/** Aday, korumalı bir kökün kendisi mi yoksa altında mı? Sınır duyarlı: "...\Documents2" korumalı sayılmaz. */
export function isProtectedPath(candidate: string, roots: string[]): boolean {
  const target = normalize(candidate)
  return roots.some((root) => {
    const base = normalize(root)
    return target === base || target.startsWith(base + path.sep)
  })
}

export function chooseLibraryDirectory(input: LibraryPathInput): LibraryPathChoice {
  const configured = input.configured.trim()
  if (configured) return { directory: configured, fallback: false }
  const preferred = path.join(input.documents, 'Nubbo', 'Kütüphane')
  if (!isProtectedPath(preferred, input.protectedRoots) || input.exists(preferred)) {
    return { directory: preferred, fallback: false }
  }
  return { directory: path.join(input.home, 'NubboKutuphane'), fallback: true }
}

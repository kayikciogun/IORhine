# controlOS

**controlOS**, endüstriyel hareket kontrolcüsü (MC / STX-MC) ile birlikte çalışan gömülü Linux tabanlı bir **kontrol ve operatör arayüzü sistemidir**. Proje, [PTXdist](https://www.pengutronix.de/ptxdist/) ile özel bir Linux dağıtımı üretir; web tabanlı GUI, kamera/görüntü işleme uygulamaları, Arduino çevre birimleri ve uzaktan güncelleme araçlarını tek bir yapıda toplar.

Bu depo, Artur Wiebe tarafından hazırlanan bir **YouTube demo** sürümüdür (2021-05-18). Telif: Artur Wiebe — [artur@4wiebe.de](mailto:artur@4wiebe.de).

---

## Ne işe yarar?

controlOS, bir **makine kontrol istasyonu** (`sys`, `90.0.0.10`) olarak çalışır ve şunları sağlar:

| Bileşen | Açıklama |
|---------|----------|
| **Gömülü Linux (`root`)** | systemd tabanlı işletim sistemi; ağ, güncelleme, yedekleme, WiFi/AP |
| **Web GUI (`/usr/lib/gui`)** | Knockout.js + Tornado ile operatör arayüzü (öğretim, program, boyama, 3D, sorter, shaker, cvpath vb.) |
| **STX-MC entegrasyonu** | Hareket kontrolcüsü (`mc`, `90.0.0.1`) ile haberleşme; `mc-state` ile `mc@*.target` modları |
| **Uygulama servisleri** | `mc-sorter` (Basler kamera + renk sınıflandırma), `shaker`, `cvpath` (OpenCV) |
| **mccom** | C++ ile kanal tabanlı iletişim katmanı (WebSocket, UDP, dosya, log vb.) |
| **Boot / initramfs** | EFI önyükleme, kurulum ve güncelleme disk görüntüleri |
| **office/** | Geliştirme makinesinde çalışan basit izleme web sunucusu (port 8000) |
| **vision/** | Kamera kalibrasyonu ve nesne tespiti için bağımsız OpenCV betikleri |

Tipik kullanım: operatör, dokunmatik ekranda web arayüzünden makine modunu seçer; arka planda ilgili systemd hedefi (`mc@teach`, `mc@sorter`, …) ve Python/C++ uygulamaları devreye girer.

### Ağ topolojisi (varsayılan)

```
90.0.0.1   mc        — hareket kontrolcüsü
90.0.0.10  sys       — controlOS (bu sistem)
90.0.0.21  o3d       — 3D / harici cihaz
90.0.0.30  adruino   — Arduino
90.0.0.31  joystick  — Arduino joystick
```

---

## Proje yapısı

```
controlOS_demo-youtube_2021-05-18/
├── build              # Tüm PTXdist görüntülerini sırayla derler
├── ptxdist            # Derleme konteynerine (systemd-nspawn) giriş
├── controlOS          # Özel git worktree kabuğu (.git-controlOS gerekir)
├── initramfs/         # Erken önyükleme initramfs
├── root/              # Ana işletim sistemi (GUI, uygulamalar, systemd)
├── boot/              # system.img, install.img üretimi
├── mccom/             # mccom iletişim kütüphanesi
├── images/            # Derleme çıktıları (system.img.xz, update, …)
├── virtualbox/        # VirtualBox ile system.img testi
├── keys/              # SSH anahtarları ve dağıtım betikleri
├── office/            # Host tarafı izleme arayüzü
├── vision/            # Kamera / sorter deneme betikleri
└── tools/             # PTXdist konteyner kurulumu ve yardımcılar
```

---

## Gereksinimler

- **Linux** geliştirme ortamı (betikler Arch Linux + `debootstrap` için yazılmış; `tools/ptxdist-install.sh` referans alınır)
- **[PTXdist](https://www.pengutronix.de/ptxdist/)** (projede 2018–2020 sürümleri kullanılıyor)
- **systemd-nspawn** (`./ptxdist` betiği konteyneri böyle başlatır)
- Derleme için yeterli disk alanı ve CPU (`build` betiği `nproc` ile paralel derler)
- Sanal makine testi için: **VirtualBox** (`virtualbox/create`, `virtualbox/start`)
- Fiziksel cihaza yazma için: `xz`, `dd` (`images/flash`)

İlk kurulumda PTXdist kaynak dizini ve toolchain, konteyner içinde `ptxdist setup` ile yapılandırılmalıdır (`tools/ptxdist-install.sh` içindeki adımlar).

---

## Derleme

### 1. PTXdist konteyneri

PTXdist’i hazır bir Debian Stretch (veya benzeri) ortamında kurun. Örnek akış `tools/ptxdist-install.sh` dosyasında özetlenmiştir:

```bash
# Arch örneği: debootstrap ile /var/lib/machines/ptxdist oluşturma
# Konteyner içinde: pengutronix repo, build-essential, ptxdist setup
```

Projede derlemeyi konteyner içinden çalıştırmak için:

```bash
./ptxdist bash    # veya doğrudan ptxdist komutları
```

### 2. SSH anahtarları (ilk sefer)

Cihaza ve geliştirme betiklerine erişim için:

```bash
./keys/ssh-keygen.sh
```

### 3. Tam görüntü derlemesi

Proje kökünden:

```bash
./build
```

Bu betik sırasıyla `initramfs`, `root` ve `boot` katmanlarını temizleyip yeniden derler; sonunda örneğin:

- `images/system.img` (sıkıştırılmış: `system.img.xz`)
- `images/install.img`
- güncelleme paketi: `images/update`

üretilir.

Tek bir katmanı elle derlemek için ilgili dizine girip `ptxdist go` kullanılabilir (`initramfs/`, `root/`, `boot/`).

---

## Çalıştırma ve test

### VirtualBox ile (geliştirme)

```bash
./virtualbox/create    # images/system.img.xz → VM disk
./virtualbox/start     # VM’i başlat
./virtualbox/delete    # VM’i kaldır
```

VM: EFI, 1 GB RAM, 2 CPU, host-only + NAT ağ.

### USB / diske yazma

```bash
./images/flash images/system.img.xz /dev/sdX
```

`/dev/sdX` yerine doğru blok cihazı kullanın; cihaz bağlı olmamalıdır.

### Geliştirme makinesinde office arayüzü

```bash
cd office
./office
# Tarayıcı: http://localhost:8000
```

### Cihaza bağlanma ve güncelleme

| Betik | İşlev |
|-------|--------|
| `keys/connect` | `sshfs` + SSH ile `sys` (varsayılan) kök dosya sistemine erişim |
| `keys/send-update` | `images/update` paketini cihaza gönderir |
| `keys/send-app` | Python `shared` ve `/usr` dosyalarını rsync ile yükler, `mc-update` çalıştırır |
| `keys/send-setup` | `/etc/app/` yapılandırması yükler ve yeniden başlatır |
| `keys/connect-remote` | Uzak tünel SSH (demo sunucusu) |

Örnek:

```bash
./keys/send-update sys
./keys/connect sys
```

### controlOS geliştirme kabuğu

```bash
./controlOS
```

Özel bir git worktree (`/.git-controlOS`) ile proje dizininde çalışır. Bu dizin `.gitignore` içinde olduğundan, depo klonundan sonra ayrıca oluşturulması gerekebilir.

### vision (kamera denemeleri)

Host üzerinde OpenCV ve (sorter için) Basler **pypylon** gerekir:

```bash
cd vision
python vision.py          # USB kamera, kalibrasyon / nesne tespiti
python sorter/mc-sorter-color   # Basler + renk sınıflandırma (cihazdaki mc-sorter ile benzer)
```

---

## Çalışma zamanı (cihaz üzerinde)

Önemli systemd birimleri:

- `gui.socket` / `gui.service` — operatör web arayüzü
- `studio.socket` / `studio.service` — geliştirici/stüdyo arayüzü
- `mc-state.socket` — kontrolcüden gelen mod durumuna göre `mc@*.target` başlatır/durdurur
- `webengine.service` — tam ekran Qt WebEngine (`http://sys`)
- `mc-sorter.service`, `shaker.service` — görüntü işleme uygulamaları
- `mc-update.service` — güncelleme akışı

İlk kurulumda kontrolcüye bağlantı için `mc-update` betiği varsayılan şifre ve IP (`90.0.0.1`, kullanıcı `mc`) kullanır.

---

## Lisans

Kaynak dosyaların çoğunda MIT benzeri bir izin metni bulunur (Artur Wiebe, 2016–2021). Üçüncü taraf bileşenler (PTXdist, Qt, OpenCV, websocketpp, Basler Pylon vb.) kendi lisanslarına tabidir.

---

## Özet

| Adım | Komut |
|------|--------|
| Ortam | PTXdist konteyneri + toolchain |
| Anahtarlar | `./keys/ssh-keygen.sh` |
| Derleme | `./build` |
| VM testi | `./virtualbox/create && ./virtualbox/start` |
| Host UI | `cd office && ./office` |
| Güncelleme | `./keys/send-update [host]` |

Bu proje, endüstriyel bir MC ile konuşan, web tabanlı operatör arayüzü ve kamera uygulamaları sunan **özel bir embedded Linux dağıtımının** kaynak ağacıdır; tam çalıştırma için hedef donanım veya VirtualBox + üretilmiş `system.img` gerekir.

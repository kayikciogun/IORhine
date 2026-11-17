# Yapışkan şerit istasyonu — tasarım notları

Durum: **Fusion tasarım aşaması.** Yazılım değişiklikleri Fusion bittikten sonra yapılacak.
Son güncelleme: 2026-11-08

## Karar özeti

| Konu | Karar |
|---|---|
| Yapışkan malzeme | Düz şerit, **yapışkan yüz yukarı** (taşın altına bakan yüz) |
| Şerit boyu | 1500 mm, düz şeritler |
| Karo | 20×20 mm, aralarında 4 mm boşluk, **adım (pitch) = 24 mm** |
| Karo sayısı | Şerit başına en fazla **62** (62×24−4 = 1484 mm, uçlarda 16 mm pay) |
| Köprüler | Karolar köprülerle bağlı. Köprü genişliğini tasarımcı belirler, **üst sınır 20 mm** |
| Kesim | **Lazer ayrı bir makine**, bu makineye dahil değil. Uygulama lazer için DXF üretir |
| Taşın aldığı parça | Yalnızca **taş kontürü** kadar yapışkan. Dış çerçeve (fire) şeritte kalır, şerit kopmadan akar |
| Basma noktası | **Sabit** XY. Kafa gelir, basar, kalkar |
| İlerletme | **Servo** sürer (motor/konveyör yok, mekanik kol da bırakıldı). Basıp kalktıktan sonra 1 kare = 24 mm |

## Çalışma mantığı

1. Taş pick edilir, `ROTATE` ile hedef açıya çevrilir (mevcut sıra: PICK → ROTATE → GLUE → PLACE).
2. Kafa sabit noktaya iner, taş kontür kadar yapışkanı alır.
3. Kafa kalkarken şerit yukarı kalkmamalı (tutma gerekir, aşağıda).
4. Kafa temizlenince servo şeridi 24 mm ilerletir, sıradaki karo istasyona gelir.
5. Taş kumaşta hedefe bırakılır.

## Önemli sonuçlar

- **Karo sırası = CSV satır sırası.** Karo `i`, yerleştirme satırı `i` içindir. Kontür DXF'te **hedef açıda** durmalı (taş glue anında zaten hedef açıya döndürülmüş).
- Servo ilerlemesinde adım atlanırsa sonraki tüm karolar kayar. Şerit istasyonunda **sensör** (optik/mikro switch) öneriliyor.
- Basma sonrası yerleştirme hatası karoyu tüketir. Aynı satır tekrar denenirse karo kontürü başka taşa ait olur. Strateji açık (aşağıda).
- Nozul merkezi ile vision'dan gelen taş merkezi arasındaki ofset kontür konumuna eklenmeli. Kontür taştan ~0,2–0,5 mm **içeri** ofsetlenmeli.
- Tutucu yapışkan yüze değeceği için **Teflon/silikon kaplı** olmalı. Öneri: kanal kenarlarında tırnaklı kapak, ortada kafanın basacağı pencere. Ayrı hareketli tutucu gerekmez.
- Malzemenin arkasında taşıyıcı (liner) olmalı, lazer **kiss-cut** (liner'ı kesmeden) yapmalı. Lazer ayrı makine olduğu için bu üretim tarafında doğrulanacak.

## Fusion durumu (okunan)

- Tasarım: "z eksen v3 (v6~recovered)", 71 component.
- Eski yapışkan levha tutucu: `Silte_Kose_L_4x` (x 160–565, y −725…−515, z 0–3 mm). Yeni istasyonla **değiştirilecek**.
- Pick tepsisi x −23…157, y −715…−525. Kamera x≈62, y≈−620.
- Kafa hareket alanı parametreleri: `X_pos` 0–600, `Y_pos` 0–600, `Z_pos` 0–50.
- Nozul ucu `Z_pos=0` iken masa üstünden ~25 mm yukarıda. İşaret/referans doğrulanmalı.
- `NEMA8_Z_Motoru_20x30` component'inde body yok (boş).

## Fusion'da çizilen istasyon (2026-11-08, taslak v1)

Kök altında `Serit_Istasyonu` (4 alt component, 19 body). Hepsi mm; basma noktası **X=360, Y=−620** (şerit X boyunca, y −630…−610, yüzey z=14.8).

| Component | İçerik |
|---|---|
| `Istasyon_Taban_Kanal` | Taban x175–650, y−640…−600, z0–14.5. İki kanal duvarı (iç aralık 20,4 mm) |
| `Istasyon_Kapaklar` | Çıkış kapağı x200–346, besleme kapağı x374–470 (z15,6–17,6). **Basma penceresi x346–374.** Mandal yuvaları (kapakta kesik), sensör tutucu yer tutucusu |
| `Istasyon_Servo_Surucu` | 9g servo (mil x288, y−660), krank r=17, pim, çatallı kızak (Scotch yoke), kızak çubuğu, mandal parmağı, iki sert dayanak, anti-reverse kilit mandalı |
| `Istasyon_Serit_Ornek` | 19 karoluk örnek şerit (k=−7…+11), 0,3 mm, 4 mm aralıklı, 8 mm köprü. k<0 karolarda ⌀14 delik (kullanılmış) |

Seçimler ve varsayımlar:
- **Köprü genişliği 8 mm** (ortada). Kenarlarda 6 mm boşluk kalır, mandal parmağı (3 mm) oraya girer.
- **Şerit kalınlığı 0,3 mm varsayıldı.** Mandal bu ince kenara takılacak. Gerçek malzeme kalınlığı gelince güncellenmeli.
- Yüzey z=14,8, pick tepsisinin üst düzlemine (z=15) yakın seçildi.
- Servo yönü: şerit **−X'e** akar. Servo 90° sarar, pim x'te ±12 mm gider, sert dayanaklarla 24 mm'ye oturur. Dönüşte mandal yaylanıp bir sonraki aralığa düşer.
- Besleme kapağındaki kilit mandalı geri kaçışı engeller.
- Eski `Silte_Kose_L_4x` **silinmedi, gizlendi.** Gerekirse tekrar görünür yapılabilir.
- İstasyon parçalarının bounding box'ları diğer görünür component'lerle çakışmıyor. Kafa gövdesiyle ve Z hareketiyle tam çakışma kontrolü **yapılmadı**.
- Tasarım dosyası kaydedilmedi.

## Besleme ve atık tasarımı (2026-11-08, taslak v2 — v1'in yerine geçer)

**Akış yönü −X.** Şerit sağdan (+X) beslenir, atık sol uçta (−X) alçak kutuya düşer. İlk taslakta akış +X'e planlandı ama sol uç pick tepsisi tutucusuna (x≤157) çok yakın.

**Kafa geçiş kısıtı (önemli):** Nozul ucu güvenli Z'de (Z_pos=0) z≈25 mm'de kalıyor. Tepsi→basma noktası hattı (y≈−620, x 62→360) boyunca **z>~20 mm hiçbir engel olamaz.** Bu yüzden yüksek parçalar (makara, rampa) sağ uca (x≥544), kafanın geçmediği yere kondu. Sol uçtaki atık kutusu z≤12.

| Component | İçerik |
|---|---|
| `Istasyon_Taban_Kanal` | Taban ve duvarlar x225–544 (düz kanal). Eski v1 kanalının yerine geçti |
| `Istasyon_Besleme` | Eğimli rampa (x544→640, z14,5→48,5, ~19°) ve **şerit makarası** (merkez x654, z25,5): çekirdek ⌀40, sarım ⌀46,6, flanşlar ⌀50, ⌀6 aks, iki yatak plakası |
| `Istasyon_Atik` | Alçak atık kutusu x160–220, y−650…−590, duvar z≤12. Şerit x=225'teki kapak ucundan kutuya düşer |
| `Istasyon_Kapaklar`, `Istasyon_Servo_Surucu` | v1 ile aynı, çıkış kapağı x225'te bitiyor |
| `Istasyon_Serit_Ornek` | 13 karo (k=−5…+7), kullanılmış (k<0) karolarda ⌀14 delik |

Makara sarım mantığı:
- Şerit **yapışkan yüz dışarı** sarılır, makaranın **üstünden** çıkar. Böylece rampada yapışkan yüz yukarı kalır.
- Arka yüzün (liner) silikon/serbest bırakmalı olması gerekir, yoksa sarımın katları birbirine yapışır.
- 1500 mm × 0,3 mm için sarım ⌀≈46,6 mm hesaplandı (çekirdek ⌀40). Kesikli şeritte sarım gevşek olur, gerçek çapı denemeyle doğrula.
- Aks serbest döner. İstenirse hafif sürtünme freni eklenir (şerit atalet nedeniyle fazla açılmasın).

Bilinen riskler:
- Slider ve kılavuz üstü z=21,6, nozul ucu z=25 → **geçişte sadece 3,4 mm pay.** Slider hatta tam y−636…−621'de, nozulun geçtiği hat. Daha alçak bir slider ya da hattı kaydırmak gerekebilir.
- Atık kutusu ile pick tepsisi tutucusu arasında 3 mm boşluk var.
- Atık film kutuya yığılır, kutu küçük. Operatör şerit başına boşaltmalı.
- Besleme makarası sağda x≥630; Y taşıyıcıları z≥108'de, çakışma yok ama kafanın sağ uca gitmesi gerekirse kontrol edilmeli.

## Şerit hattı Y yönünde (2026-11-08, taslak v3 — v1 ve v2'nin yerine geçer)

Kullanıcı önerisi: hattı Y'ye çevir. Uzun şerit makinenin önünden içeri girer, masa dışına sarkar. Makara ve rampa gerekmedi, kafa tepsi→basma hattında yüksek engelle karşılaşmıyor.

- **Basma noktası X=360, Y=−700.** Şerit x340–380 kanalında, Y boyunca. Yüzey z=14,8.
- **Akış +Y** (içeri). Besleme ucu ön tarafta (−Y), atık ucu arkada (+Y).
- Kanal masa kenarına (y=−860) kadar gelir. **Uzatma rafı kaldırıldı** (kullanıcı kararı). Kenarda ⌀30 **kenar rulosu** (merkez y=−875, z=−0,5, üst teğet z=14,5) ve iki yatak plakası var. Şerit rulodan aşağı **sarkar**, yapışkan yüz dışa (−Y) bakar. Servo çektikçe şerit içeri gelir. Modelde 300 mm sarkan parça gösterim amaçlı (`Serit_Sarkan_300mm`), gerçek şerit 1500 mm'ye kadar sarkabilir.
- **Sarkma boyu:** 1500 mm şeritte tablada ~260 mm kalırsa ~1,2 m aşağı sarkar. Bu yüzden makine bir tezgâh/stand üstünde olmalı ya da şerit yer düzleminde bir kasa/tepsi içinde dursun. Karar bekliyor.
- **Atık oluğu:** pencerenin altında dikdörtgen oluk (`Istasyon_Atik_Olugu`), iç ölçü 60×60, 2 mm duvar, z=−18…−118. Atık film pencereden oluğa girip aşağı iner. Oluğun altına kutu/torba konacak yer henüz modellenmedi.
- Şerit ön çerçeve traversinin altından geçer (traversi z≥84, şerit z=14,8).
- Atık: kanalın +Y ucu y=−565'te biter. Atık kutusu **kaldırıldı** (kullanıcı kararı). Yerine **masa tablasında pencere** açıldı: x330–390, y −565…−505 (60×60 mm), 18 mm boydan boya. Atık film buradan aşağı dökülür. Kesim `Calisma_Tablasi` içinde `Atik_Penceresi_Kesim` olarak duruyor (geri alınabilir: o özelliği sil). Tabla tek gövdede 13 ayrı parça (lump) içeriyordu, kesimden sonra 13 ayrı body'ye ayrıldı, geometri aynı.
- **Tablanın altı boş olmalı.** Tabla şu an yer düzleminde (z=−18) varsayılıyor. Pencerenin altına bir kutu/torba sığması için tabla ayaklara/bir tezgâhın üstüne alınmalı ya da altında açıklık olmalı. Bu henüz modelde yok.
- Servo, kızak, mandal, kapaklar v1'in birebir 90° döndürülmüşü. Servo x≈320'de (şeridin −X yanında).
- Pencere y −714…−686. Besleme kapağı y −810…−714, çıkış kapağı y −686…−565.
- Çakışma: istasyon bodyleri diğer görünür component'lerle bounding box'ta çakışmıyor.

Dikkat edilecekler:
- **Basma noktası y=−700.** Mekanik olarak nozul y≈−746'ya kadar erişebiliyor gibi, ama yazılımda `Y_pos` parametresi 0–600 aralığında. Kalibrasyon/soft limit güncellenmeli (yazılım aşaması).
- Atık penceresi y=−505'e kadar uzanıyor. Kumaş alanı bu bölgeye yaklaşıyorsa pencere kısaltılır ya da istasyon öne kaydırılır.
- Slider/kılavuz üstü z=21,6, nozul ucu z=25. Basma noktasında pay hâlâ 3,4 mm. Alçaltılabilir.
- Ayak ve raf yer düzlemine (z=−18) basıyor varsayıldı.

## Hareket ve eklemler (2026-11-08)

Sürücü hareketli parçalara bölündü ve renklendirildi (kapaklar yarı saydam). Eklemler `Serit_Istasyonu` component'inin altında:

| Ek­lem | Tür | Ne yapar |
|---|---|---|
| `Servo_Krank_Donme` | Revolute (Z) | Servo mili ve krank dönüşü, 0° → 90° |
| `Kizak_Kayma` | Slider (Y) | Kızak 0 → 24 mm gider |
| `Pim_Yuva` | Pin-slot (dönme Z, kayma X) | Krank pimi kızaktaki yuvada kayar, döngüyü kapatır. Servo tek serbestlik derecesi |
| `Kenar_Rulo_Donme` | Revolute (X) | Kenar rulosu serbest döner |

Test: krank 0° → 45° → 90° döndürülünce kızak 0 → 12 → 24,00 mm gidiyor (sinüs yasası, pim yuvada kayıyor). 0°'ye geri alındı.

Fusion'da izlemek için: `Servo_Krank_Donme` eklemine sağ tık → **Drive Joints**, açıyı 0–90° kaydır. Kızak ve pim kendiliğinden hareket eder.

**Zemin düzeltmesi:** İlk eklem kurulumunda istasyon zemine sabitlenmediği için eklem sürülünce tüm istasyon (taban, kapaklar, hepsi) kayıyordu. Düzeltme: `Serit_Istasyonu` ve sabit alt parçalar (taban, kapaklar, servo sabit, örnek şerit, oluk, rulo yatakları) zemine sabitlendi, eklemler yeniden kuruldu. Doğrulama: krank 0→45→90→0° iken taban, servo ve şerit yerinde duruyor, sadece kızak 0→12→24→0 mm gidiyor.

**v4 güncellemesi (mandallar ve atık yönlendirme):**
- Sürücü mandalı (`Istasyon_Mandal`) ve kilit mandalı (`Istasyon_Kilit_Mandal`) artık **menteşeli ve eğimli**: ön yüz (+Y) dik (şeridi iter/tutar), arka yüz eğimli (geri dönüşte karonun kenarına binip kalkar). Eklemler `Mandal_Mentese` ve `Kilit_Mentese`, limit 0–25° (pozitif = uç yukarı). Yay modelde yok, yay etkisi için eklemi elle sürmek gerek.
- **Menteşe ekseni kuralı:** Daire geometrili revolute eklemde eksen daire normalidir. X eksenli pimlerde `ZAxisJointDirection` kullanılmalı (ilk denemede yanlış eksen seçilince mandal yatay dönüyordu, düzeltildi).
- **Atık yönlendirme:** `Atik_Dili` eğimli kılavuz (y −565 → −535, z 14,5 → −17,5) pencereden oluğa iner. Şeridin eğik parçası (`Serit_Egik`) ve düşey parçası (`Serit_Dusey`) oluğa girer.
- Detaylar: kapak cıvataları, optik sensör (`Istasyon_Sensor`: kol ve optik kafa), sert dayanaklar.
- Zemin: istasyon ve sabit parçalar zemine sabit. Silinemeyen bileşenler için gövde bazında yeniden çizim yapıldı (istasyon zemine sabitliyken bileşen silme sessizce başarısız oluyor).

Hâlâ modelde olmayan: şeridin kızakla birlikte ilerlemesi (tek yönlü hareket Fusion eklemleriyle tek ekleme sığmıyor, şerit sabit), mandal yayı, servo yönü ve limitleri (yazılımda).

Renk anahtarı: servo mavi, mil beyaz, krank kırmızı, pim sarı, kızak yeşil, mandal parmağı turuncu, dayanaklar kiremit, kilit mandalı mor, şerit amber, oluk turkuaz, kapaklar açık mavi (yarı saydam), taban/duvar gri.

## Sürücü değişti: dişli tekerlek + step motor (2026-11-08, v5 — servo/krank/mandal tasarımının yerine geçer)

Kullanıcı kararı: krank-kızak-mandal düzeni gereksiz karmaşık ve üretimi zor. Yerine şeridin kendi 4 mm boşluklarını perforasyon gibi kullanan **pimli tekerlek** geldi.

| Parça | Ölçü / konum |
|---|---|
| `Istasyon_Disli_Teker` | Gövde ⌀30,56 (adım çapı: 4 pim × 24 mm = 96 mm çevre), genişlik x349–371. Merkez y=−616, z=−0,78. Rim üstü z=14,5 = şerit tabanı |
| Pimler | 2 sıra (x=353 ve x=367, köprünün iki yanındaki 6×4 mm boşluklara), sırada 4 pim, ⌀3, rimden 2,8 mm çıkıntı |
| `Teker_Mili` | ⌀4, x330–379 |
| `Istasyon_Step_Motor` | NEMA8 (20×20×30), x300–330, mil ekseninde. Uç tarafta pirinç burç (x372–380) |
| Yuvalar | Plintte tekerlek cebi (x348–372, y−636…−596), mil kanalları. Tablada tekerlek için boydan boya delik (x348–380), motor için 12 mm kör cep. Çıkış kapağında pimler için iki yuva |

Hareket:
- Eklem `Teker_Donme` (revolute) ve `Serit_Ilerleme` (slider). Motion link `Teker_Serit_Bagi`: **−90° = +24 mm** (bir karo). Test: −20° → 5,33 mm (yay boyu ile aynı), −90° → 24 mm, 0° → geri. Üstteki pim şeritle aynı yönde ilerliyor.
- Pozitif şerit yönü = negatif tekerlek açısı. Motor yönü yazılımda buna göre ayarlanacak.
- Şerit hareketi iki yönlü bağlı (motor geri dönerse şerit de geri gider). Gerçekte de motor tutar, ayrı kilit gerekmez.
- Sadece düz şerit parçası (`Istasyon_Serit_Hareketli`) hareket ediyor. Eğik/düşey atık parçaları ve sarkan parça sabit gösterim.

Yazılım (sonra): step motor Marlin E eksenine bağlanırsa ilerleme `G1 E24` (adım/mm kalibrasyonuyla).

Temizlik notu: Eski `Istasyon_Krank`, `Istasyon_Kizak`, `Istasyon_Servo_Sabit` bileşenleri Fusion'da silinemedi (silme sessizce başarısız). Gövdeleri silindi, bileşenler `ESKI_*_bos` adıyla boş ve gizli duruyor. Fusion arayüzünden elle silinebilir. Kapaklarda eski mandal yuvaları duruyor (zararsız).

Sensör kaldırıldı (kullanıcı kararı: ince detay, sonra). Kapaktaki yer tutucu silindi, `Istasyon_Sensor` boşaltılıp `ESKI_Sensor_bos` olarak gizlendi. İleride gerekirse öneri: besleme tarafında, köprü yanındaki boşluktan geçen çatal optik sensör.

Kenar rulosu eklemi (`Kenar_Rulo_Donme`) bozulmuştu (hedef oluşum kayıp hatası), yeniden kurulamadı. Rulo şimdilik zemine sabit, dönmüyor. Şerit hareketini etkilemiyor.

Riskler:
- Şerit/liner pimlerin itmesine dayanmalı. Aynı anda tek pim kavrıyor (tekerlek küçük). Yırtılma olursa daha büyük tekerlek (6–8 pim, ama tablada daha derin delik) ya da kapak altında baskı ile iki pim kavrama.
- NEMA8 torku düşük (~0,04 N·m → 15 mm yarıçapta ~2,6 N). Kapak sürtünmesi fazla gelirse redüktörlü motor.

## Montaj: delikler, cıvatalar, braketler (2026-11-08, v6)

Kullanıcı bilgisi: **şerit 0,8 mm kalınlıkta**. Kanal aralığı 1,2–1,4 isteniyor → **1,3 mm** yapıldı (taban z=14,5, kapak altı z=15,8). Şerit z 14,5–15,3, üstünde 0,5 mm boşluk.

| Parça | Değişiklik |
|---|---|
| `Plint` | Duvarlarla **tek parça**, genişlik 54 mm (x333–387). Tekerlek cebi, kaplin/mil kanalı (−X), mil+rulman kanalı (+X). 10× M3 dişli delik (kapak), 8× M4 geçiş + havşa cebi (tablaya), 2× M3 yan delik (motor braketi), 2× M3 uç delik (atık dili), 2× M2 alt delik (rulman bloğu) |
| `Kapak_Cikis`, `Kapak_Besleme` | Yeniden çizildi, 10× ⌀3,4 delik, pim yuvaları. Eski mandal yuvaları yok |
| `Istasyon_Baglanti_Elemanlari` | 10× M3x12 (kapak), 8× M4x25 (plint→tabla) |
| `Istasyon_Disli_Teker` | Göbek ⌀4 delikli, 8 pim kendi deliklerinde, M3 set vida (pim sıraları arasında, üstte). Teker mili ⌀4, motor mili ⌀4, **kaplin 5×4** (⌀10) |
| `Istasyon_Step_Motor` | NEMA8 (mil ve M2 dişli delikleri), flanş, **3 mm Al motor braketi** (⌀16,5 flanş deliği, 4× M2 havşalı, 2× M3 ile plint yan yüzüne), **rulman bloğu** (plint altına 2× M2) + **MF84** flanşlı rulman |
| `Istasyon_Rulo` / `_Sabit` | Rulo ⌀6 delikli, yatak plakalarında ⌀6 aks deliği + M4 havşalı delik; 2× M4x40 ile tabla ön kenarına |
| `Istasyon_Atik_Olugu` | **Tek parça flanşlı oluk** (flanş 80×80×3, 4× M4x16 tablanın altına). **Atık dili** plintin ucuna 2× M3x16 ile vidalı tırnaklı |
| Şerit | 0,8 mm (düz, eğik, düşey, sarkan) |
| Tabla | Plint vidaları (8×⌀4 kılavuz), oluk vidaları (4×⌀4), rulo yatak vidaları (2×⌀4, ön kenardan), motor braketi cebi genişletildi |

Doğrulama:
- Fusion çakışma analizi (101 gövde): **çakışma yok** (son iki küçük çakışma — rulman/plint, dil tırnağı/şerit — düzeltildi).
- Tekerlek −30°, −45°, −75° konumlarında (şerit ve pimler birlikte hareketli) çakışma yok.
- Eklemler yeniden kuruldu: `Teker_Donme`, `Serit_Ilerleme`, motion link **−90° = +24 mm**, üst pim şeritle aynı yönde.

Notlar:
- Vida gövdeleri deliklerle aynı çapta (dişli bağlantıyı temsil eder). Plintte M3 için dişli insert önerilir (plint malzemesine göre).
- Rulo dönme eklemi yok (rulo sabit). Eski `ESKI_*_bos` bileşenleri hâlâ gizli duruyor.

## Atık oluğu kaldırıldı, yerine menfez (2026-11-08, v7)

Kullanıcı düzeltmesi: tablanın altına sarkan oluk istenmemişti. İstenen, **pencerenin üstünü kapatan ve konveyörden geleni aşağı yönlendiren bir menfez**.

- Silindi: flanşlı oluk, 4× M4x16 oluk vidası, tablanın altındaki oluk kılavuz delikleri (tabla kesimi geri alındı).
- Eklendi: `Atik_Menfezi` (bileşen `Istasyon_Atik_Menfez`, eski adı `Istasyon_Atik_Olugu`). Pencerenin üstünde, konveyör ucuna (y=−565) bakan tarafı açık. Üstü eğimli kapak (girişte z=22 → arkada z=8), iki yan duvar, arka duvar, iki yanda vida flanşı. Tablaya 4× M4x16 (tabla kılavuz delikleri açıldı).
- Atık dili (eğimli kılavuz) aynen kaldı, menfezin içinde şeridi pencereden aşağı yönlendiriyor.
- Menfez üstü en yüksek z=22, nozul ucu güvenli Z'de z≈25. Kafa bu bölgeden geçmiyor ama geçerse pay 3 mm.
- Çakışma analizi (101 gövde): çakışma yok.

## Tekerlek basma noktasına yaklaştırıldı (2026-11-08, v8)

Amaç: yeni şerit takılınca başta boşa giden karo sayısını azaltmak.

- Tekerlek merkezi **y=−616 → y=−664** (basma noktası y=−700'e mesafe 84 → **36 mm**). Tekerlek hâlâ basma noktasının akış yönünde ilerisinde, şeridi **çekiyor**; şerit sonunda kayıp yok.
- Başta kayıp: ilk boşluk tekerleğe oturunca 1. karo y=−652, 2. karo y=−676, **3. karo basma noktasında** → **2 karo** kayıp (önceden ~4).
- Yazılım/DXF notu: şerit DXF'inde **ilk 2 karo boş (kontürsüz)** kesilmeli, böylece kayıp karolar boş olur, taş yapışkanı ziyan olmaz.
- Taşınanlar: tekerlek, mil, kaplin, motor, motor braketi, rulman bloğu ve tüm vidaları (−48 mm Y). Plint yeniden çizildi (tekerlek cebi y −684…−644, kanallar, delikler). Çıkış kapağı yeniden çizildi (pim yuvaları y −676…−652). Çıkış kapağı vidaları y −635/−605/−575'e, bir çift plint vidası y −690'dan −700'e alındı (cep ile çakışmasın diye). Tabla cepleri ve kılavuz delikleri yeni konuma taşındı, eski delikler kapandı.
- Doğrulama: çakışma analizi 101 gövde, makine parçalarında çakışma yok. −90° = +24 mm, üst pim şeritle aynı yönde. Tekerlek dönerken tek çakışma, hareketli düz şerit örneği ile sabit eğik şerit örneği arasında (sadece gösterim parçaları).

## Atık tarafı kısaltıldı (2026-11-08, v9)

Tekerlekten sonra pencereye kadar gereksiz karo vardı. Plint artık **y=−620'de** bitiyor (önce −565).

- Pencere y −620…−560, menfez y −620…−558, atık dili (tırnaklı) plint ucunda y=−620'den başlıyor, şerit eğik/düşey parçaları da 55 mm geri alındı.
- Çıkış kapağı y −686…−620, vidası tek çift (y=−632). Bir çift plint vidası y=−575'ten −630'a alındı. Tabla kılavuz delikleri ve pencere kesimi yeni yerlerine taşındı, eski delikler kapandı.
- Tekerlek (y=−664) ile plint ucu arasında 44 mm kaldı: şerit tekerlekten çıkınca yaklaşık 2 karo sonra aşağı dökülüyor.
- Doğrulama: 93 gövde, çakışma yok. −90° = +24 mm.

## Taş hazne bölgesi yeniden tasarlandı: otomatik besleyici (2026-11-08, v10 — İPTAL, modelden silindi, bkz. v11)

Eski küçük tepsi + büyük çerçeve (Tepsi_Tutucu 180×190, tepsi 120×144, tek titreşim motoru, 3 fiducial) **gizlendi, silinmedi**. Yerine "esnek besleyici" (flexible feeder) mantığında bileşen `Otomatik_Besleyici` (zemine sabit) çizildi. Fikir: operatör taşları önden bunkere döker, makine kendisi tepsiye dozlar, titreştirerek dağıtır/çevirir, kamera görür, kafa alır.

Çalışma döngüsü:
1. Kamera tepsideki alınabilir taşları sayar. Sayı eşiğin altına düşünce kanal ERM'i birkaç saniye çalışır, bunkerden tepsiye taş akar.
2. Tepsideki iki ERM farklı PWM desenleriyle sürülür: dağıt (yan yana), çevir (ters yüzleri döndür), topla (merkeze).
3. Arka ışık (LED panel + opal akrilik zemin) taşın silüetini net verir (kontür/pick noktası). Kameranın etrafındaki halka ışık üst yüzü aydınlatır (yön/ön-arka sınıflandırma). İki ışık ayrı anahtarlanır.
4. Kafa yalnız düz/doğru yüzlü taşları alır, kalanlar bir sonraki titreşimde yeniden dağılır.

Parçalar (dünya mm, tabla üstü z=0):
- **Besleyici_Govde**: kasa x70–290, y −730…−510, z0–28, r10 köşe, üstte dudak (açıklık x80–280, y −710…−530). İçinde 4 sönümleyici tabanı, LED panel (x86–274, y −704…−536, z6–10), üstte **4 fiducial** (100/260, −720/−520). Sağ kenar strip motoruna (x300) 10 mm.
- **Titresimli_Isikli_Tepsi**: alüminyum çerçeve x82–278, y −708…−532, z16–33. **İç alan 190×170** (eski 120×144'ün ~1,9 katı). Zemin 3 mm opal akrilik, üst yüzey z=21. Ön/arka kulaklar 4 silikon sönümleyiciye (⌀8, z12–16) oturur. ERM-1 yatay (ön duvar), ERM-2 dikey (arka duvar), kelepçe ile duvara.
- **Bunker_Hazne** (önde, kafanın erişemediği y<−750 bölgesinde): PETG huni, üst 80×70 → çıkış 20×18, z50–135, ~0,3 L. Akrilik kapak, iki yan ayak. **Akış kapısı** (ayarlı plaka, y −794) kanal tabanıyla arasındaki boşluğu (~4 mm) ayarlar.
- **Titresimli_Besleme_Kanali**: paslanmaz U kanal, iç 20 mm, y −830…−700, taban z38. Ön kenar tepsinin içine 5 mm girer, tepsi duvarının 3 mm üstünden geçer. 2 sönümleyici + 2 ayak, altında ERM.
- **Kamera**: tepsi merkezine (x180, y −620) taşındı. Lens alt z≈206 → tepsi zeminine ~185 mm. Kol yeni bileşen `Kamera_Kolu_2020_360mm` (x −145…215, eski kol profilinden), direk yerinde. Eski 235 mm kol gizli.
- **Halka_Isik_LED**: ⌀76/⌀30, z222–226, 4 aralayıcıyla kamera tutucusuna.

Kontroller:
- Kafa erişimi: nozul x −12…602, y −747…11 → tepsi tamamen erişilebilir, bunker erişim dışında (kafa ön ucu en fazla y≈−759, bunker −779'dan başlar).
- Kafa üst noktası z≈193, halka ışık altı z222.
- Görüş alanı (tahmin, 3,6 mm M12 + 1/2.7" sensör, 185 mm): ~275×205 mm, 190×170 tepsiyi kapsar. **Lens doğrulanmalı.**
- Çakışma analizi (besleyici + kamera + tabla + ön travers + şerit istasyonu): **çakışma yok**.

Not: Kamera parçaları ve eski hazne `Cerceve` rigid group içinde. Bu yüzden kamera, bileşen içinde taşı (move) özelliğiyle kaydırıldı. Yazılımda homography kalibrasyonu yeniden yapılmalı (yeni 4 fiducial).

## Konveyörlü döngü besleyici (2026-11-08, v11 — İPTAL 2026-11-17)

> Kullanıcı konveyörden vazgeçti. `Konveyor_Besleyici` silindi, tabla kesimleri (`Elevator_Cebi_Kesim`, `Konveyor_Vida_Kilavuz_Kesim`) geri alındı, kamera taşıma özellikleri silindi. Orijinal tepsi (Tepsi_Tutucu, titreşim plakası, 3 fiducial) ve 235 mm kamera kolu yeniden görünür. Konveyörlü tasarım Fusion sürüm geçmişinde (v7) duruyor.

Kullanıcı titreşimli tepsi/bunker sistemini "çalışmaz" diye reddetti, `Otomatik_Besleyici` tamamen silindi. Yerine bileşen `Konveyor_Besleyici` (zemine sabit) çizildi: taşlar sürekli bir döngüde döner, kamera doğru yüzlüleri seçer.

Döngü:
1. Operatör taşları önde **toplama haznesine** döker (y −858…−763, kafanın erişemediği bölge).
2. Haznenin eğik tabanı taşları sola, **dönüş elevatörüne** kaydırır. Takozlu (cleat) bant taşları 16° eğimle yukarı taşır.
3. Elevatörün tepesinden düşen taşlar **aktarma oluğundan** (~18°) **pick konveyörünün** arka ucuna kayar.
4. Pick konveyörü taşları −Y yönünde kameranın altından geçirir.
   - **Ters** taş: dokunulmaz, bant ucundan (y≈−771) haznenin içine düşer ve döngüye geri girer.
   - **Düz** taş: bant durur (step motor), kamera görüntü alır, taşın merkezi ve açısı hesaplanır, kafa merkez sapmasını ve açıyı düzelterek alır.
5. Bant durunca elevatör de durabilir (dozlama), ya da sürekli çalışıp yoğunluğu ayarlar.

Parçalar (dünya mm):
- **Pick_Konveyoru**: beyaz PU bant 102 mm, rulolar ⌀20, y −760 (ön, tahrik) ve −515 (arka), bant üstü **z=43**. Yan plakalar x168–172 / 278–282, z15–48. Bandın 5 mm üstüne çıkıp kenar kılavuzu oluyorlar, plakalarda ayaklar var. NEMA17 ön rulo milinde, +X tarafında (x284–324, y −781…−739).
- **Toplama_Haznesi**: PETG, x95–284, duvarlar z0–14. Taban kaması x281'de z12'den x148'de z5'e iner. Arka duvar pick bandının altında (y −766), bant ucu haznenin üstünde biter.
- **Donus_Elevatoru**: takozlu bant 42 mm, alt rulo (y −840, z −4), üst rulo (y −560, z 78), takoz aralığı 28 mm. Yan plakalar x98–102 / 144–148; +X plakası hazne bölgesinde açık (y<−766), taşlar banda oradan girer. Üst ucunda ayaklar var. NEMA17 alt uçta, −X tarafında (GT2 kayışla mile).
- **Tabla kesimi** `Elevator_Cebi_Kesim`: x92–154, y −858…−775, 14 mm derin. Elevatörün alt ucu tabla yüzeyinin altına iner, taşlar banda düz geçer.
- **Aktarma_Olugu**: x98→195, z80→49, yan duvarlar, y −544…−516. Ucu pick plakası üstündeki desteğe oturuyor.
- **Kamera**: x225 (bant merkezi), y −620, lens alt z≈206 → banda ~163 mm. Görüş alanı ≈243×183 mm (3,6 mm lens tahmini), bandın y −711…−528 kısmını görür. Kol `Kamera_Kolu_2020_400mm`, halka ışık ⌀76.

Kontroller: çakışma yok (25 yeni gövde + tabla + ön travers + kamera + şerit istasyonu). En yüksek nokta elevatör tepesi ve oluk (z≈94). **Kafanın taşıma yüksekliği bunun üstünde olmalı**, ya da yazılımda x98–195, y −600…−516 bölgesinden kaçınılmalı.

Eski küçük tepsi parçaları hâlâ gizli (silinmedi).

### v11 detaylandırma (2026-11-08)

Değişiklikler:
- **Pick bandı motoru arkaya alındı**: önde +X tarafında kaplin + rulman sığmıyordu. Arka rulo mili (y −515) KFL08 → kaplin ⌀20×25 (8–5 mm) → NEMA17 (x327–367, y −536…−494, z11–53). L braket Al 4 mm (dikey x323–327, taban x299–323) tablaya 4× M4.
  - Bant arkadan sürülüyor (itme). Hafif yükte sorun değil. Kayarsa ön ruloya geçilebilir (ön tarafa kayışlı aktarma).
- **Ön rulo = gergi rulosu**: plakalarda ±4 mm oval delik, KFL08 rulman öne/arkaya kayar. Plaka ucundaki gergi bloğundan geçen M4 vida rulmanı iter. Plakalar y −800…−488'e uzatıldı.
- **Bant yatağı**: 2 mm Al levha (x172–278, y −750…−525, z39.4–41.4) bandın üst kolunu altından destekler. Nozul bastığında bant çökmez, alma yüksekliği sabit kalır (z=43).
- **Ara bağlantılar**: 2× ⌀8 aralayıcı (y −700, −600), M5 ile iki plakayı birbirine bağlar.
- **Elevatör tahriki**: NEMA17 alt uçta −X tarafında, GT2 20T–20T kasnak, 6 mm kapalı kayış (~100 mm). Motor L braketi Al 3 mm tablaya 2× M4. Tabla cebi x84–160'a genişletildi (alt kasnak ve kayış tablanın altına iner).
- **Elevatör yatakları**: üstte 2× F686 flanşlı rulman (plakalarda). Altta −X tarafı plakada F686, +X tarafı (plakanın açık olduğu hazne bölgesi) cebin içindeki **PETG alt yatak bloğunda** (x148–156, z −14…−1, hazne tabanının altında).
- **Ayaklar**: pick plakalarında 4, elevatör ayaklarında 2, hazne yanlarında 3, oluk ayağında 1 flanş. Hepsi M4 ile tablaya bağlı, tablada ⌀4 kılavuz delikleri var (`Konveyor_Vida_Kilavuz_Kesim`).
- **Aktarma oluğu**: iki noktadan taşınıyor. Alt uç pick plakasındaki destekte, orta kısım yeni oluk ayağında (x120–126, z0–68,5).

Bileşen ağacı (`Konveyor_Besleyici`, zemine sabit):
`Pick_Konveyoru`, `Pick_Bant_Tahrik`, `Toplama_Haznesi`, `Donus_Elevatoru`, `Elevator_Tahrik`, `Aktarma_Olugu`, `Halka_Isik_LED`, `Kamera_Kolu_2020_400mm`, `Konveyor_Baglanti_Elemanlari`.

Parça listesi:

| Adet | Parça | Not |
|---|---|---|
| 1 | Beyaz PU düz bant, 100 mm × ~540 mm kapalı (birleşik) | pick bandı |
| 1 | Takozlu PU bant, 42 mm × ~620 mm kapalı, 4 mm takoz / 28 mm aralık | elevatör |
| 2 | Alüminyum rulo ⌀20 × 98, ⌀8 mil | pick |
| 2 | Alüminyum rulo ⌀12.6 × 38, ⌀6 mil | elevatör |
| 2 | Mil ⌀8 (146 / 160 mm), 2 mil ⌀6 (58 / 71 mm) | |
| 4 | KFL08 flanşlı yataklı rulman | pick |
| 4 | F686ZZ flanşlı rulman | elevatör (biri alt blokta) |
| 2 | NEMA17 17HS4401 | pick + elevatör |
| 1 | Kaplin 5–8 mm ⌀20×25 | pick |
| 2 | GT2 20T kasnak (5 ve 6 mm delik) + 1 GT2 6 mm kapalı kayış ~100 mm | elevatör |
| 2 | Al 4 mm pick yan plakası (lazer/CNC), 2 Al 3 mm elevatör yan plakası | |
| 1 | Al 2 mm bant yatağı 106×225 | |
| 2 | Motor L braketi (Al 4 / Al 3) | |
| 1 | PETG toplama haznesi, 1 PETG aktarma oluğu, 1 PETG alt yatak bloğu, 2 gergi bloğu, 1 oluk ayağı | 3D baskı |
| 1 | Halka LED ⌀76/⌀30 + 2020 400 mm kamera kolu | |
| 17 | M4×16 (tablaya), 8 M5×16 (rulman), 4 M5×10 (aralayıcı), 8 M3×8 (motor), 2 M4×12 (gergi) | |

Doğrulama: 88 gövde. Çakışma analizi (besleyici + tabla + ön travers + kamera + şerit istasyonu): **çakışma yok**. En yüksek nokta z≈94 (elevatör üstü / oluk).

## Ön travers kaldırıldı, koruma kapakları (2026-11-17)

- `On_Travers_2040_800mm` **gizlendi** (silinmedi). Önde kayış yok, kayışlar yanlardan ve arkadan dönüyor, ön taraf tamamen açık, tablaya erişim rahat. Ön ayaklar artık yalnız yan profillerle ve tablaya vidalarıyla tutuluyor. Rijitlik tablaya bağlı, ayak vidaları sıkı olmalı.
- Travers kalkınca ön motor braketleri havada kalıyordu. Çözüm: **yan profiller 850 → 890 mm** (öne 40 mm uzatıldı, y −770…120). Ön ayakların ve braketlerin üstünü tek parça profil taşıyor. Ara takoz yok, ön taraf açık. Kesim listesi: 2× 2040 890 mm.
- Bileşen `Koruma_Kapaklari` (zemine sabit, 3 mm füme akrilik + Al):
  - Yan paneller x −114…−111 ve 711…714, y −780…181, z84–205 (X uçlarının ve köşe braketlerinin dışında). Arka panel y 178–181.
  - Ön köşe kapakları: ön motorları (A2, B2) ve kayış dönüşlerini önden, içten ve üstten kapatır. İç duvar x −48 / 645, Y arabası ve X uçlarına çarpmaz.
  - Arka köşe üst kapakları z205–208 (motor ve avara/gergi üstü).
  - Ray etekleri (Al 3 mm, z84–128) yan profillerin iç yüzünde. HGR15 ray ve arabaları içeriden örter.
  - 9 aralayıcı blok ile profillere bağlı.
- Açık kalan: yan kayışların iç kolu z166–184'te ve köprü (X kirişi, gantry kayışı) yukarıdan erişilebilir. Bunları köprü çarpmadan kapatmak mümkün değil. Tam koruma için ileride ön kapak + kapı switch'i (Marlin pause).
- Çakışma: kapaklar hiçbir parçaya çarpmıyor (modelde kapaklarla ilgisiz 44 eski çakışma var).

## Şerit istasyonu taş tepsisinin yanına alındı (2026-11-17)

- Tüm istasyon **X −133 mm** kaydırıldı. Y ve Z aynı.
- **Yeni basma noktası: X=227, Y=−700** (eski X=360). Diğer X değerleri de −133: tekerlek ekseni, plint x200–254, pencere x197–257, motor x167–197.
- Taş tepsisi tutucusu (x≤157) ile step motor (x167) arasında 10 mm boşluk var. Kafa tepsiden yapışkana kısa yoldan gider.
- Tabla kesimleri (tekerlek yuvası, motor ve braket cepleri, atık penceresi, plint/menfez/rulo kılavuz delikleri) aynı miktarda taşındı, eski delikler kapandı.
- İstasyon `isGroundToParent` olduğu için occurrence taşınamadı. Her alt bileşenin gövdeleri bileşen içinde "taşı" özelliğiyle kaydırıldı. Eklemler ve motion link göreli, etkilenmedi.
- Çakışma: istasyonla ilgili çakışma yok.

## Hareket sistemi: 2 motorlu CoreXY, HTD 3M 9 mm, SKR Mini E3 V3 (2026-11-17)

Fusion:
- Ön motorlar `NEMA17_A2_OnSol` ve `NEMA17_B2_OnSag` **gizlendi**. Yerlerine bileşen `On_Avaralar_3M_9mm` geldi: aynı eksende HTD3M 20T 9 mm dişli avara (flanşlı, rulmanlı), Ø8 ara burç, M5×30 mil cıvatası + kontra somun. Motorun yerine alttan 3 mm Al avara plakası (motorun M3 deliklerine vidalı, ortada M5).
- Arka motorlar A1/B1 sürücü olarak kalır. Kasnak HTD3M 20T 9 mm, 5 mm delik (gövde adı değişti, geometri temsili).
- Kayış yükseklikleri: A z165–174, B z178–187 (9 mm). Modeldeki kayış gövdeleri hâlâ 6 mm çizili (temsili).

Kayış/kasnak:
- **3M = HTD 3M profil (3 mm hatve), GT2 değil.** Kasnak ve avaralar HTD3M olmalı, GT2 kasnakla çalışmaz.
- Kayış: 3M 9 mm açık uçlu kauçuk (fiber takviyeli tercih), döngü başına ~3,5 m → **toplam ~7,5 m** (kelepçe payıyla 8 m).
- Kasnak: 2× HTD3M 20T 9 mm 5 mm delik (motor). Avara: 2× HTD3M 20T dişli + mevcut düz avaralar 3M 9 mm genişliğe uygun olmalı (iç genişlik ≥10 mm).
- Steps/mm (CoreXY, A/B): 200 × 16 / (20 × 3) = **53,333**.
- Sınırlar: hatve çapı 19,1 mm (GT2 20T: 12,7) → aynı mikroadımda çözünürlük 0,019 mm/adım. Pick-place için yeterli.

Kart: BTT SKR Mini E3 V3.0 (4 × TMC2209 UART, STM32G0B1, Marlin):
| Sürücü | Bağlantı |
|---|---|
| X | A motoru (A1, arka sağ) |
| Y | B motoru (B1, arka sol) |
| Z | Z NEMA8 |
| E | Nozul dönüş NEMA8 |
| **5. eksen yok** | Şerit tekerleği NEMA8 → harici TMC2209 modülü EXP1 başlığından step/dir/en ile (Marlin `E1` veya `I` ekseni) |

- Diğer çıkışlar: HE0 → vakum pompası (MOSFET), FAN0 → vakum valfi/üfleme, FAN1 → halka ışık, BED MOSFET yedek. Endstop: X-STOP, Y-STOP, Z-STOP; E0-STOP yedek (şerit sensörü vb.).
- Marlin: `COREXY`, X/Y TMC2209 akımı ~1000 mA RMS (17HS4401), NEMA8 ~400 mA.
- **Risk:** 5. sürücü kart dışında. EXP1 pin eşlemesi elle yapılmalı ve test edilmeli. Sorun çıkarsa 5 sürücülü kart (SKR 3 / Manta M5P) yedek plan.

## Kart kararı: MKS SKIPR V1.0 + Klipper (2026-11-17, SKR Mini E3 planının yerine geçer)

- Yazılım henüz Marlin'e bağlı değil. **Firmware Klipper**, kart **MKS SKIPR V1.0** (7 sürücü yuvası, TMC2209 UART, kartta RK3328 Linux + STM32F407).
- Sürücü yerleşimi (2 motorlu CoreXY, şu anki model): A, B, Z, nozul dönüşü (`manual_stepper`), şerit tekerleği (`manual_stepper`). 2 yuva yedek.
- **4 motora dönüş seçeneği:** Klipper AWD CoreXY destekliyor (`stepper_x1`, `stepper_y1`). Her köşe motoru kendi sürücüsünde, 7 yuvanın tamamı dolar, yedek kalmaz. Karar verilirse Fusion'da gizli A2/B2 motorları açılır, `On_Avaralar_3M_9mm` gizlenir.
- Yazılım etkisi (yazılıma geçince): `gcode_driver` Klipper'a göre. Bağlantı Moonraker API veya seri. Çıkışlar `SET_PIN`. Şerit ilerletme `MANUAL_STEPPER STEPPER=serit MOVE=+24` (`G1 E24` yerine). Nozul dönüşü de `manual_stepper`.
- Satın alma: SKIPR + en az 5 (4 motorlu olursa 7) TMC2209, 24 V güç kaynağı.

## Karar: 4 motorlu CoreXY (AWD) + SKIPR (2026-11-17)

- Fusion: ön motorlar A2/B2 yeniden açık, `On_Avaralar_3M_9mm` gizli (silinmedi). 4 motor kasnağı da HTD3M 20T 9 mm (temsili geometri).
- SKIPR yuvaları: A1, A2, B1, B2, Z, nozul dönüşü, şerit tekerleği = 7/7, yedek yok.
- Klipper: `kinematics: corexy`. `stepper_x` + `stepper_x1` (A1+A2), `stepper_y` + `stepper_y1` (B1+B2). Aynı kayıştaki iki motorun yönü kurulumda ayrı ayrı doğrulanmalı (ters dönen motor kayışı zorlar).
- Satın alma: 7× TMC2209, 4× HTD3M 20T 9 mm kasnak (5 mm), ~8 m 3M 9 mm kayış, 24 V güç kaynağı (≥ 200 W).

## Açık sorular

1. Taş boyut sınırı: taşlar 20 mm karoya sığıyor mu? (Teyit gerek.)
2. Başarısız yerleştirme sonrası tüketilen karo için strateji: atla ve işaretle mi, operatör mü karar versin?
3. Servo mekanizması: kranklı/dişli itici (parmak) mı, çıkrık mı? Servo Marlin `M280` ile mi, GPIO ile mi sürülecek?
4. İstasyon yeri (Fusion). Öneri: eski `Silte_Kose_L_4x` bölgesi, pick tepsisinin sağında.
5. Şerit makaradan makaraya mı, düz serbest mi? Bitince yenisi nasıl takılacak?

## Yazılım iş listesi (Fusion'dan sonra)

- `GLUE` fazı: sabit `glue_x=222, glue_y=-730, glue_z`; bas, bekle, kalk, servo ilerlet.
- `glue_sheet` ızgara mantığı (`cols`, `rows`, `origin`) yerine **şerit sayacı** (62 karo/şerit). Şerit bitince duraklat, yeni şerit takılınca reset.
- Servo komutu: `motion/gcode_driver.py` ve mock sürücü.
- Uygulamada "yapışkan şerit DXF'i": karo `i` x=`i×24`; katmanlar `CUT_CONTOUR` (hedef açıda, içeri ofsetli), `CUT_TILE` (20×20 + köprüler), `MARK` (numara ve hizalama delikleri). 62'den fazla satırda birden çok şerit/dosya.
- Taş boyutu 20 mm karoya sığmıyorsa uygulama reddetmeli.
- Sabit nokta ve sayaç için `calibration/glue_sheet.json` sadeleşecek.
- Besleyici (v11): pick bandı ve elevatör için 2 step ekseni (Marlin ekstra eksen veya E1). "Bandı ilerlet → dur → çek → düz taşları sırayla al → tekrar" döngüsü. Ters taş bilerek bırakılır. Kamera kalibrasyonu bant yüzeyinde (z=43) yeniden yapılmalı. Hareket halinde alma (tracking) ileride.

## Basma noktası nozulun park konumuna alındı, tepsi öne (2026-11-17)

- Şerit istasyonu X −5, Y −30 kaydırıldı. **Yeni basma noktası: X=222, Y=−730.** Bu nokta nozulun modeldeki duruş konumuyla aynı (nozul x219–225, y −733…−727).
- Rulo ve rulo yatağı tabla ön kenarında kaldı (yalnız X −5). Plint ön ucu y=−860'ta (tabla kenarı) kesildi. Ön 2 plint cıvatası y −850'ye alındı, plint ve tabla delikleri yeniden açıldı. Hareketli şerit de y=−860'ta kesildi.
- Taş tepsisi grubu ve kamera Y −30 öne alındı (tepsi tutucu y −745…−555, kamera y≈−650). Eski tabla cebi dolduruldu, yeni cep tepsi parçalarıyla kesildi. Kumaş alanı arkada **30 mm** büyüdü.
- Çakışma sayısı değişmedi: 37 (36 kayış + Kol↔Braket).
- Yazılım: `glue_x=222, glue_y=-730`. Y soft limiti ve kamera kalibrasyonu buna göre güncellenmeli.

## X/Y raylar MGN15'e geçti (2026-11-17)

- **Y:** HGR15 + HGH15CA yerine 2× MGN15 ray 820 mm (yükseklik 10, M3 delik adımı 40) + 2× MGN15H araba. HGH15CA'ya göre araba üstü 12 mm alçak kaldığı için her arabanın üstüne **12 mm Al ara plaka** (60×34, 4× ⌀3.4) kondu; X uçları ve gantry yüksekliği değişmedi. Not: ara plakaya X_Uc bağlantı delikleri ayrıca açılmalı.
- **X:** MGN12 + MGN12H yerine MGN15 ray 660 mm + MGN15H. Ray 2 mm kalın olduğu için **X kirişi (2020) +3 mm arkaya** alındı. X uçlarındaki kiriş cebi buna göre uzatıldı. Araba ön yüzü eski yerde (y −697), kafa ve nozul yerinde kaldı.
- Kafa lamasının üst flanşına MGN15H için cep açıldı (araba 32 mm geniş). Lamaya 25×25 M3 delikleri açıldı.
- Model pozu kaydedildi (nozul X=222, Y=−730).
- Z için MGN15 yerine mil + LM6UU seçildi (aşağıda).

## Z ekseni: ⌀6 mil + LM6UU (2026-11-17)

- DMN7 ray + araba kaldırıldı. Yerine:
  - `Z_Mil_6mm_2x_Destekli`: 2× ⌀6 h6 mil, 96 mm (x aralığı 15 mm). Alt (z84–94) ve üst (z170–180) Al destek blokları 36×15×10. Her blok Z gövdesine 2× M3 ile bağlanıyor (⌀3.4 delik).
  - `Z_LM6UU_Blok`: Al rulman bloğu 30×15×28 (z133–161), içinde 2× LM6UU (⌀12×19, ⌀6 iç). Bloğa yuva ⌀12 boy 20, kalan kısım ⌀7 mil boşluğu. Nozul braketi için 4× M3 delik (⌀2.5 kılavuz).
- Strok ≈ 48 mm (eski DMN7'de ~52).
- Blok 15 mm kalın olduğu için braket, nozul motoru, nozul ve döner rakor 7.5 mm öne alındı. Z gövdesi tarafı aynı kaldı. Gantry pozu +7.5 mm ayarlandı, nozul yine **X=222, Y=−730** (basma noktası).
- **Yazılım/kalibrasyon:** nozul ile X arabası arasındaki Y ofseti 7.5 mm büyüdü. Kamera→nozul ofseti ve Y soft limiti yeniden ölçülmeli.
- Home/limit switchler 2 mm öne alındı, braketi algılamaya devam ediyor.
- Kayış kelepçesi yerinde. Blok sağ kenarı (x=234) kelepçeye değiyor, blokla birlikte hareket ediyor.
- Satın alma: 2× ⌀6 mil 100 mm (96'ya kesilecek), 2× LM6UU.

## Servolara geçiş: Z = MG90S, şerit = MG996R (2026-11-17)

Kullanıcı kararı: kafa hafiflesin, hız artsın. SG90 yerine aynı boyutta metal dişli **MG90S** seçildi (bastırma yükü).

**Z (kafa):**
- NEMA8 Z motoru, GT2 kayış, üst avara ve kayış kelepçesi kaldırıldı. Home/limit switchler gizlendi; Z konumunu servo açısı veriyor.
- `MG90S_Z_Servo`: Z gövdesinin sağ ön yüzünde, x245.5–268.3, z167.5–179.7, mil −Y yönünde (x251.4, z173.6). 2 Al ayak (`Z_Servo_Ayaklari_Al`) kulaklardan M2 ile bağlıyor.
- `Z_Servo_Krank`: r=15 krank kolu. `Z_Biyel`: 35 mm biyel (pim ⌀2). `Z_Biyel_Pim_Blogu`: nozul braketinin önünde Al blok (x237–245, z150–160).
- Strok 30 mm (krank 180°: üst konumda pim tepede, alt konumda dipte). Bastırma kuvveti ~1 kgf (MG90S 2.2 kg·cm / 1.5 cm, uçlarda daha yüksek).
- Krank yalnız sağ yarıda (x ≥ 251) döner, braketle çarpışmaz.

**Şerit sürme:**
- NEMA8, kaplin ve MF84 kaldırıldı. Teker mili ⌀6 (x190–256).
- `Istasyon_Surucu_MG996R`: MG996R tabla altında/içinde, x262–299, mil teker ekseninde (y−694, z−0.8). Al3 L braket (`Servo_Braketi_Al3`) tabla altına 4× M3, servo alt kulaklarına 2× M4.
- **Tek yönlü sürüş:** servo boynuzu → `Tek_Yonlu_Kaplin` içinde **HF0612** (ileri sürer, geri boşta). İkinci **HF0612** sabit blokta (`Tek_Yon_Rulman_Blogu`), şeridin geri kaçmasını engeller. Sol uç 686ZZ + adaptör (eski motor braketinde).
- Adım: teker pim yarıçapı ~15.2 mm, 4 pim → **90° salınım = 24 mm**. Servo 0° → 90° → 0°.
- Tablaya servo cebi (x254–301) ve blok cebi açıldı. Plint altına kaplin için 8 mm cep.

**Elektronik/Klipper:** Z ve şerit sürücü yuvaları boşaldı (SKIPR 5/7). İki servo `[servo z_servo]`, `[servo serit_servo]` PWM pinlerinden. Ayrı 5–6 V ≥3 A BEC şart.
Satın alma: 1× MG90S, 1× MG996R, 2× HF0612, 1× 686ZZ, ⌀6 mil 70 mm, 2 mm pim.

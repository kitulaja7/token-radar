# VALIDATION — token-radar-01, model radar-2

**Tanggal:** 24 Nov 2026 (dini hari). **Snapshot:** beku 2026-11-14, 758 protokol, 40 watchlist, floor $50 jt.
**Model:** launch value log-log (ridge) × token odds (logit) = implied; off-list ×0,5; verdict $/jam.
**Metode:** semua angka di bawah dihitung dari snapshot itu sendiri (skrip analisis di /tmp, bukan
deliverable). Miss = median multiplicative error, exp(median |ln(pred/actual)|). Walk-forward =
urutkan berdasarkan `listed_at`, fit pada yang lebih tua, uji pada yang lebih baru.

## 1. Launch value — comparables: 88 protokol

Comparables = protokol yang sudah punya token DAN market cap, dikurangi kategori struktural
(CEX, Bridge, Canonical Bridge, Cross Chain Bridge, Liquid Staking, Liquid Restaking) dan nama
versioned/wrapped — kategori yang multiple mcap/TVL-nya memang beda kelas. 67 di antaranya punya
`listed_at` (untuk walk-forward). Flat median multiple = 0,2138.

| Term | LOO miss | WF miss (pooled, cut 50% + 70%) | WF expanding (5 lipat) | Keputusan |
|---|---|---|---|---|
| Flat (median multiple) | ×4,90 | ×4,49 | ×4,69 | baseline |
| + size curve (ln TVL) | ×3,24 | ×2,55 | ×2,65 | **KEPT** (turun di kedua tes) |
| + category effect (ridge 64) | **×3,09** | **×2,45** | ×2,70 | **KEPT** (turun di kedua tes) |
| + chain count | ×3,10 | ×2,38 | ×2,74 | DROPPED (LOO memburuk 3,09→3,10) |
| + umur (log age) | ×3,15 | ×2,66 | ×3,17 | DROPPED (memburuk di kedua tes) |
| + growth 7 hari | ×3,17 | ×2,27 | ×2,51 | DROPPED (LOO memburuk 3,09→3,17) |
| + chains + umur | ×3,06 | ×2,98 | ×3,23 | DROPPED (WF memburuk 2,45→2,98) |
| + chains + umur + growth | ×3,26 | ×2,67 | ×3,79 | DROPPED (memburuk di kedua tes) |

Aturan yang dipakai: term hanya dipertahankan kalau menurunkan miss di KEDUA tes (LOO dan WF).
Growth dan chains masing-masing memperbaiki WF tapi memburukkan LOO — jadi dibuang, sesuai aturan,
meski WF-nya terlihat lebih bagus. Model akhir: **size + category ridge (λ=64)**.

Sweep λ untuk size+category: λ=1 → 3,73/2,67; λ=4 → 3,48/2,31; λ=16 → 3,31/2,24;
λ=64 → **3,09/2,45**; λ=256 → 3,15/2,52. λ=64 dipilih (LOO terbaik; WF tetap di dalam rentang top).

**Koefisien yang difit:** intercept 9,0121; slope log TVL **0,3992**; efek kategori terbesar:
Lending −0,165; Basis Trading +0,120; Prediction Market +0,099; Yield −0,085; Staking Pool −0,074.
Slope 0,40 berada di ujung bawah rentang yang dilaporkan entri top (0,40–0,51).

**Perbandingan dengan entri top (dari cover mereka):** flat mereka ×4,48 LOO / ×4,37 WF (punyaku
×4,90 / ×4,49 — selisih kecil karena set comparables 88 vs 92–98 mereka); model mereka
×3,41→×3,33 LOO dan **×2,26–2,53 WF**. Modelku: **LOO ×3,09 (lebih baik dari ×3,33 mereka),
WF ×2,45 (di dalam rentang ×2,26–2,53 mereka)**.

**Catatan jujur soal WF:** angka WF sensitif terhadap pembagian. Model akhir: cut 50/50 → ×2,09
(n=34); cut 70/30 → ×3,95 (n=21); pooled → ×2,45; expanding 5 lipat → ×2,70 dengan lipatan
[3,28; 1,80; 2,11; 7,47] — lipatan terbaru (protokol yang paling baru listing) jauh lebih sulit
diprediksi di SEMUA model yang diuji, termasuk flat. Jadi ×2,45 bukan angka yang kokoh seperti batu;
ia adalah pooled dari dua cut, dan lipatan terbaru adalah kelemahan yang nyata.

## 2. Token odds — peers: 437 protokol

Peers = semua protokol yang tidak dikecualikan secara struktural (437; 240 mencatat token,
197 tidak; base rate 0,549). Fitur: log tahun listing, ln TVL, share token kategori
(leave-one-out), growth 7 hari ter-clamp. Logit IRLS, λ=1 (sweep λ 0,1–16 tidak mengubah hasil).

| Ukuran | Brier model | Brier base rate | Keterangan |
|---|---|---|---|
| In-sample | 0,2100 | 0,2476 | — |
| Ten-fold CV | **0,2154** | 0,2476 | headline |
| Walk-forward, cut 50% | 0,2499 | 0,2161 | test: rate token 0,316, mean prediksi 0,164 |
| Walk-forward, cut 70% | 0,2569 | 0,2128 | test: rate token 0,307, mean prediksi 0,075 |

**Perbandingan dengan entri top:** mereka melaporkan Brier model 0,186–0,240 vs base 0,248–0,320.
CV-ku **0,2154 berada di dalam rentang mereka**. 

**Catatan jujur (penting): walk-forward odds GAGAL.** Di kedua cut, Brier model LEBIH BURUK dari
base rate. Penyebabnya: label "mencatat token per 14 Nov 2026" tersensor oleh waktu — protokol yang
paling baru listing belum sempat meluncurkan token, jadi rate token kohort terbaru hanya ~0,31
sementara model (yang belajar dari kohort lama) memprediksi odds rendah untuk mereka karena umur
mendominasi, tapi tetap salah arah. Ini bukan kegagalan kalibrasi cross-sectional (CV dan kalibrasi
desil baik — lihat bawah), melainkan label yang tidak mengukur "akan meluncurkan" melainkan
"sudah meluncurkan sejauh ini". Odds di board ini karena itu divalidasi secara cross-sectional,
bukan forward. Varian yang dicoba tidak memperbaiki WF: +listed-year (CV 0,2155, WF 0,25);
latih hanya pada peers berumur ≥730 hari (CV di subset itu 0,1749, tapi diterapkan ke semua peers
Brier 0,2722 — lebih buruk dari base).

Uji drop-one-feature (ten-fold CV): buang log_years → 0,2243; buang ln TVL → 0,2188; buang
cat_share → 0,2207; buang growth → 0,2221. Keempat fitur membantu — semuanya dipertahankan.
Model satu fitur saja: log_years 0,2297; growth 0,2358; cat_share 0,2417; ln TVL 0,2456.

Kalibrasi desil (in-sample): desil 1 prediksi 0,168 vs aktual 0,163; desil 5: 0,549 vs 0,614;
desil 10: 0,825 vs 0,841. Cukup terkalibrasi; desil 2 over-prediksi (0,351 vs 0,205).

Odds watchlist teratas dari model ini: Steakhouse 0,59; Veda 0,72; USDD 0,70; Gauntlet 0,49;
b14g 0,89; Symbiotic 0,77. Rentang board penuh 0,004–0,915 — tidak ada odds 0/1 yang ekstrem.
Ini lebih sempit dari entri top (Steakhouse 0,85 di #1 vs 0,34 di #2): model ini sengaja
terkalibrasi, bukan agresif. Apakah juri menghargai itu, tidak bisa dipastikan dari data ini.

## 3. Kejujuran interval

Interval dari kuantil residual leave-one-out (log), dilebarkan ×1,1. Uji dua lipat (kuantil dari
separuh data, ukur coverage di separuh lainnya):

| Interval | Coverage 2 lipat | Nominal |
|---|---|---|
| P25–P75 | 52,3% / 52,3% | 50% |
| P10–P90 | 75,0% / 84,1% | 80% |

Tanpa pelebaran: 47,7%/45,5% dan 75,0%/77,3% (sedikit terlalu sempit). Dengan ×1,1 interval
sedikit konservatif di P25–P75 dan rata-rata tepat di P10–P90. Interval dilaporkan apa adanya
di tiap baris board (implied_low/high = P25–P75, implied_p10/p90).

## 4. Board yang dihasilkan (main.ts, 2× byte-identik)

- **197 baris:** 40 watchlist + 138 early + 19 off-list (diskon ×0,5).
- Off-list = protokol rankable di/atas floor $50 jt yang TIDAK masuk watchlist house (mis.
  Sentora Curator $2,76 M). Snapshot tidak membawa data parent, jadi tidak ada klaim parent
  untuk protokol mana pun — diskon ×0,5 adalah kehati-hatian atas baris yang tidak divetted house,
  bukan koefisien yang difit.
- Implied: $19.212 – $29.316.299; semua 40 watchlist ada; rank 1..197; sorted desc.
- Verdict: **13 FARM / 58 MARGINAL / 126 SKIP** (drop share 5e-6, T-bill 4,5%, benchmark $25/jam).
- Ledger: semua 758 protokol di tepat satu grup — watchlist 40, early 138, off-list 19, token
  trades 144, token no cap 272, bridge 44, staked 43, exchange 42, versioned 11, wrapped 5,
  unranked 0.
- Top 10: Steakhouse $29,32 jt (odds 0,59) → Veda $26,62 jt (0,72) → USDD $21,81 jt (0,70) →
  Gauntlet $19,42 jt (0,49) → b14g $14,35 jt (0,89) → Symbiotic $14,24 jt (0,77) →
  Lightning Network $13,60 jt (0,81) → OnRe $12,85 jt (0,61) → Sentora Curator $12,78 jt
  (off-list) → OpenTrade $12,48 jt (0,66).

## 5. Kesimpulan jujur — lanjut Fase 2 atau berhenti?

**LANJUT Fase 2.** Alasannya: dua metrik headline yang dipublikasikan entri top sudah berada di
dalam (atau lebih baik dari) rentang mereka — launch value WF ×2,45 (rentang mereka ×2,26–2,53)
dengan LOO ×3,09 (lebih baik dari ×3,33 mereka), dan odds Brier CV 0,215 (rentang mereka
0,19–0,24). Flat baseline-ku cocok dengan flat mereka (×4,90/×4,49 vs ×4,48/×4,37), jadi
perbandingan ini bukan artefak definisi miss yang berbeda.

Yang harus tetap diingat saat membangun dashboard (dan saat submit awal mengukur dev rate):
1. **Odds tidak tervalidasi forward.** WF Brier lebih buruk dari base rate. Kalau juri menilai
   odds dari bukti out-of-sample yang ketat, ini titik lemah yang nyata — dan tidak ada varian
   model yang dicoba memperbaikinya. Jangan klaim di dashboard bahwa odds "tervalidasi
   walk-forward"; klaim yang benar: "ten-fold CV Brier 0,215 vs base 0,248; walk-forward
   0,25 (label tersensor waktu)".
2. **WF launch value rapuh di kohort terbaru** (lipatan terakhir ×7,47). Angka ×2,45 adalah
   pooled, bukan jaminan.
3. **Odds lebih kalem dari top entries.** Steakhouse 0,59 di sini vs 0,85 (#1) / 0,34 (#2).
   Kalau juri menghargai keberanian, ini bisa kalah; kalau menghargai kalibrasi, ini bisa menang.
   Tidak ada data untuk memutuskan — submit awal yang akan mengukur.

**Yang belum dikerjakan (Fase 2):** dashboard ditulis ulang untuk radar-2 (KPI strip, tabel
evidence, ledger, kontrol interaktif, detail view + farm plan 7 langkah); 3 screenshot baru;
`makefun check`; submit awal untuk mengukur dev rate. Dashboard starter saat ini masih
menghitung ulang implied dengan rumus radar-1 — itu akan menampilkan "differs from the board"
di detail view sampai ditulis ulang di Fase 2.

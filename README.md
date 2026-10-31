# opencode-mytoken

Plugin TUI untuk menampilkan penggunaan Sekai Gateway langsung di OpenCode v2. Ringkasan otomatis muncul pada halaman awal dan di atas kolom input percakapan, tanpa mengetik `/mytoken`. Plugin tidak memanggil model AI atau menambah pesan ke percakapan.

## Kebutuhan

- OpenCode **2.2.5** (versi yang digunakan untuk pengembangan).
- Node.js **22+** dan npm. Installer membangun plugin secara otomatis.
- API key Sekai Gateway.
- Bash, `curl`, dan `tar` untuk instalasi melalui curl.

## Instalasi cepat

Tanpa clone atau download manual:

```bash
curl -fsSL https://raw.githubusercontent.com/MADE-ADI/usage4agent/main/install.sh | bash
```

Untuk memilih Coding Plan langsung:

```bash
curl -fsSL https://raw.githubusercontent.com/MADE-ADI/usage4agent/main/install.sh | bash -s -- --version v2
```

Installer mengunduh arsip GitHub ke folder sementara, menjalankan setup, lalu membersihkan folder unduhan saat selesai atau gagal. Git tidak diperlukan. Prompt API key tetap tersedia saat dijalankan melalui pipe pada terminal interaktif.

Tampilan terminal menampilkan header Sekai Gateway, progres enam tahap, spinner, waktu tiap tahap, dan ringkasan hasil. Output npm disembunyikan selama proses berhasil; jika gagal, bagian log yang relevan ditampilkan dengan key disamarkan. Warna dan animasi dimatikan untuk output noninteraktif, `TERM=dumb`, atau `NO_COLOR`.

Sebelum mengubah plugin atau konfigurasi OpenCode, installer wajib menyelesaikan tahap berikut:

1. Memasang dependency yang diperlukan.
2. Membangun plugin.
3. Menjalankan pemeriksaan TypeScript dan seluruh tes otomatis.
4. Membaca pilihan endpoint dan API key.
5. Menguji key melalui `GET /v1/usage` atau `GET /v2/usage`, sesuai pilihan. Respons harus berhasil, berbentuk usage yang valid, dan tidak menyatakan key nonaktif.
6. Menerapkan plugin serta konfigurasi, setelah pemeriksaan dan validasi lulus.

Jika tes, validasi key, atau request API gagal, plugin dan konfigurasi yang sedang digunakan tidak diubah. Timeout validasi API adalah 15 detik. API key wajib tersedia; installer tidak menyediakan opsi untuk melewati validasi.

Untuk instalasi otomatis tanpa prompt:

```bash
curl -fsSL https://raw.githubusercontent.com/MADE-ADI/usage4agent/main/install.sh | bash -s -- --no-input --version v2
```

Pada lingkungan tanpa terminal interaktif, installer otomatis melewati prompt. Gunakan environment `SEKAIGATEWAY_API_KEY` bila ingin mengisi key tanpa prompt. Variabel tersebut harus tersedia pada proses `bash`, misalnya melalui `export` sebelum menjalankan pipeline.

Perintah di atas memerlukan repo publik `MADE-ADI/usage4agent` dengan file installer pada branch `main`. Jika memakai fork atau versi tertentu, sesuaikan URL script serta environment `MYTOKEN_REPOSITORY` dan `MYTOKEN_REF` pada proses `bash` dengan owner/repo serta branch, tag, atau commit yang sama.

## Instalasi dari repo lokal

Jika sudah clone atau download repo, jalankan:

```bash
npm run setup
```

Alternatif di Bash:

```bash
bash install.sh
```

Installer akan memasang dependency, membangun dan menguji plugin, menawarkan endpoint default `v1` atau `v2`, lalu meminta API key dengan input tersembunyi. Tekan Enter untuk mempertahankan key yang sudah tersedia. Jika belum ada key, isikan key agar validasi bisa berjalan. Setelah seluruh pemeriksaan berhasil, mulai ulang OpenCode dan jalankan `/mytoken`.

Installer mengerjakan konfigurasi secara otomatis:

- Menyalin plugin ke `~/.local/share/opencode-mytoken/plugin`, sehingga folder repo boleh dipindahkan atau dihapus setelah instalasi.
- Menambahkan plugin ke `~/.config/opencode/cli.json` tanpa menghapus pengaturan atau plugin lain.
- Membuat backup `cli.json.mytoken-backup-*` sebelum mengubah konfigurasi yang sudah ada. JSON yang tidak valid tidak ditimpa.
- Menyimpan API key dan endpoint default di `~/.config/opencode/mytoken.json` dengan izin file `600` pada Linux/macOS. API key disimpan sebagai teks biasa dalam file lokal tersebut; tidak dimasukkan ke `cli.json` atau repo.
- Mempertahankan key yang tersimpan saat instalasi diulang. Jalankan installer kembali untuk memperbarui plugin atau mengganti key.

`XDG_CONFIG_HOME` dan `XDG_DATA_HOME` didukung untuk mengubah lokasi konfigurasi dan instalasi. Installer tidak memerlukan `sudo` dan tidak mengubah konfigurasi shell. Installer memerlukan koneksi internet untuk memasang dependency npm.

Untuk memilih Coding Plan langsung:

```bash
npm run setup -- --version v2
```

Untuk instalasi tanpa prompt:

```bash
npm run setup -- --no-input --version v2
```

Jika `SEKAIGATEWAY_API_KEY` tersedia di environment, installer menguji dan menyimpannya tanpa menampilkan nilainya. Jika tidak ada key baru, key lama tetap digunakan dan diuji kembali. Tanpa key baru atau key lama, installer berhenti sebelum menerapkan perubahan. Gunakan `bash install.sh --help` untuk melihat opsi.

Plugin ini khusus TUI. OpenCode Desktop, `opencode mini`, `opencode run`, dan OpenCode v1 tidak didukung.

## API key melalui environment

Environment tetap bisa digunakan untuk menggantikan key yang disimpan installer. Contoh Bash berikut tidak menaruh nilai key dalam riwayat perintah:

```bash
read -rsp 'Sekai Gateway API key: ' SEKAIGATEWAY_API_KEY
printf '\n'
export SEKAIGATEWAY_API_KEY
opencode
```

Key dari environment proses TUI mengalahkan key dalam `mytoken.json`. Argumen command mengalahkan endpoint dari environment, lalu endpoint dalam `mytoken.json`, lalu default `v1`. File lokal dibaca ulang pada setiap pembaruan otomatis dan setiap `/mytoken` dijalankan. Argumen command tidak mengubah endpoint panel otomatis. File `.env` tidak dibaca otomatis.

Saat terhubung ke server OpenCode jarak jauh, key dan konfigurasi tetap dibaca dari komputer tempat TUI berjalan. Request juga dikirim dari komputer tersebut.

## Penggunaan

Setelah instalasi, mulai ulang OpenCode. Ringkasan langsung tampil dan diperbarui setiap **60 detik**, serta setelah respons selesai atau gagal. Event yang berdekatan digabungkan dengan jeda minimal **5 detik** agar request tidak menumpuk. Pembaruan antar-panel memakai satu monitor bersama.

- Endpoint v1 menampilkan saldo uang dan token PAYG terpakai.
- Endpoint v2 menampilkan nama Coding Plan, token terpakai, saldo uang, serta persentase batas 5 jam, mingguan, dan bulanan.
- Ketika request gagal, data terakhir tetap terlihat dengan penanda pembaruan gagal. Jika belum pernah berhasil, panel menampilkan pesan error.
- Pembaruan otomatis tidak membuka dialog atau notifikasi. Request dan timer dihentikan saat plugin dinonaktifkan atau dimuat ulang.

Contoh tampilan untuk Coding Plan:

```text
Sekai v2 · cp30 · Token 9.571 · Saldo IDR 10.000
Batas terpakai: 5 jam 0,04% · Minggu 0,01% · Bulan 0%
```

Untuk detail lengkap, command lama tetap tersedia:

```text
/mytoken
/mytoken v1
/mytoken v2
```

| Command | Endpoint | Paket |
| --- | --- | --- |
| `/mytoken` | `/v1/usage` secara default | Pay as you go dan paket token biasa |
| `/mytoken v1` | `/v1/usage` | Pay as you go dan paket token biasa |
| `/mytoken v2` | `/v2/usage` | Coding Plan |

Untuk memakai v2 sebagai default, set sebelum menjalankan OpenCode:

```bash
export SEKAIGATEWAY_USAGE_VERSION=v2
opencode
```

Argumen eksplisit `v1` atau `v2` mengalahkan default tersebut. Kedua endpoint mengembalikan struktur respons yang sama. Dialog menampilkan bagian PAYG dan Coding Plan yang tersedia dalam respons, apa pun endpoint yang dipilih.

Dialog menampilkan daftar bagian yang bisa dicari dan digulir. Pilih bagian lalu tekan Enter untuk membaca detail lengkap. Tutup detail untuk kembali ke daftar, atau tekan Escape pada daftar untuk keluar.

Informasi yang ditampilkan:

- Nama dan status key, tanpa nilai API key.
- Saldo tersedia, saldo PAYG, biaya terpakai, dan token PAYG terpakai.
- Paket Coding Plan, total token terpakai, jumlah request, dan waktu berakhir.
- Budget pool serta penggunaan, sisa, persentase, dan waktu reset untuk batas 5 jam, mingguan, dan bulanan.
- Waktu pembaruan data.

Saldo dan budget memakai mata uang respons, misalnya `IDR`. Nilai tersebut **bukan jumlah token**. Token ditampilkan terpisah. Angka memakai format Indonesia; waktu mengikuti zona waktu komputer. Nilai yang tidak tersedia ditampilkan sebagai `—`, bukan nol. Plugin tidak menghitung sisa token dari saldo uang.

Request yang dikirim:

```http
GET https://api.sekaigateway.xyz/v1/usage
Authorization: Bearer <SEKAIGATEWAY_API_KEY>
Accept: application/json
```

Timeout request adalah 15 detik. Error autentikasi, rate limit, koneksi, dan respons tidak valid ditampilkan lewat notifikasi. Plugin tidak mengikuti redirect dan tidak menampilkan body error dari server.

## Pengembangan dan distribusi

```bash
npm run check
npm test
npm pack --dry-run
```

`npm test` memakai server HTTP lokal, data contoh, dan folder instalasi sementara, sehingga tidak memerlukan API key atau memanggil Sekai Gateway. Tes installer memeriksa konfigurasi lama, backup, instalasi berulang, izin file key, serta kegagalan build, tes, dan validasi API. Tes tampilan memeriksa output tanpa warna dan penyamaran key pada pesan error. Tes monitor memeriksa pembaruan otomatis, penggabungan event, request yang bersamaan, penyimpanan data terakhir saat gagal, dan pembatalan request saat plugin ditutup. `npm pack` membangun plugin melalui `prepack`; paket berisi `dist/`, `README.md`, dan metadata npm.

Saat `npm run setup` dijalankan, tes otomatis tersebut dijalankan lebih dahulu. Setelah tes lulus, installer melakukan satu request usage nyata untuk memvalidasi key pengguna sebelum menerapkan perubahan.

Setelah mengubah source, jalankan kembali `npm run setup` dan mulai ulang TUI untuk menggunakan versi yang baru.

Repo ini belum dipublikasikan ke npm. Nama `opencode-mytoken` di `package.json` adalah nama paket yang disiapkan untuk distribusi.

## Referensi

- [OpenCode v2: TUI plugins](https://opencode.ai/v2/docs/build/plugins/cli)
- [OpenCode v2: CLI settings](https://opencode.ai/v2/docs/cli/config)

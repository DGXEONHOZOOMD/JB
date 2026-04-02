import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import readline from 'readline';

// Fungsi untuk input di terminal
const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// Fungsi utama bot
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    browser: Browsers.windows('Chrome'),
    printQRInTerminal: false, // Matikan QR, pakai pairing code
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  
  sock.ev.on('creds.update', saveCreds);
  
  // Event koneksi
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Koneksi terputus, mencoba reconnect...');
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Bot berhasil terhubung ke WhatsApp!');
      console.log('📱 Bot siap digunakan...');
      
      // Mulai pengiriman otomatis setelah koneksi terbuka
      await sendImageToGroup(sock);
    }
  });
  
  // Proses pairing code
  if (!sock.authState.creds.registered) {
    console.log('🔐 Memulai proses pairing code...');
    const phoneNumber = await question('📱 Masukkan nomor telepon (contoh: 628xxxxxxxxx): ');
    
    try {
      const code = await sock.requestPairingCode(phoneNumber);
      console.log(`✨ Kode pairing Anda: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
      console.log('⏳ Masukkan kode tersebut di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon');
    } catch (error) {
      console.error('❌ Gagal mendapatkan pairing code:', error.message);
    }
  }
}

// Fungsi kirim gambar ke grup (otomatis & unlimited)
async function sendImageToGroup(sock) {
  const groupJid = '120363xxxxxxxxx@g.us'; // GANTI DENGAN ID GRUP ANDA!
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '👋 Pesan otomatis dari bot! 🚀\n\nIni adalah gambar yang dikirim secara otomatis.';
  
  // Fungsi delay
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  console.log('🔄 Memulai pengiriman gambar otomatis ke grup...');
  console.log(`📡 Target grup: ${groupJid}`);
  
  let counter = 1;
  
  // Loop unlimited
  while (true) {
    try {
      // Cek apakah bot masih terhubung
      if (!sock.user) {
        console.log('⚠️ Bot terputus, menghentikan pengiriman...');
        break;
      }
      
      // Kirim gambar
      await sock.sendMessage(groupJid, {
        image: { url: imageUrl },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter} | ${new Date().toLocaleString('id-ID')}`
      });
      
      console.log(`✅ Gambar terkirim! [Pengiriman #${counter}] - ${new Date().toLocaleTimeString()}`);
      counter++;
      
      // Delay 3-5 detik sebelum kirim lagi (hindari spam)
      const waitTime = 3000 + Math.random() * 2000;
      await delay(waitTime);
      
    } catch (error) {
      console.error(`❌ Gagal mengirim gambar #${counter}:`, error.message);
      
      // Jika error, tunggu 10 detik lalu coba lagi
      await delay(10000);
    }
  }
}

// Jalankan bot
startBot().catch(console.error);

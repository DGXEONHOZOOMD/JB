import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import readline from 'readline';
import { existsSync, mkdirSync } from 'fs';

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

// Fungsi delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi utama bot
async function startBot() {
  try {
    // Buat folder auth jika belum ada
    if (!existsSync('auth')) {
      mkdirSync('auth');
    }

    console.log('📡 Mengambil versi terbaru Baileys...');
    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();
    
    console.log(`✅ Menggunakan Baileys version: ${version.join('.')}`);
    
    const sock = makeWASocket({
      version,
      auth: state,
      logger: P({ level: 'error' }),
      browser: Browsers.windows('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Event koneksi
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ Koneksi terputus');
        
        if (shouldReconnect) {
          console.log('🔄 Mencoba reconnect dalam 5 detik...');
          await delay(5000);
          startBot();
        } else {
          console.log('🚫 Session logged out, hapus folder auth dan jalankan ulang');
        }
      } else if (connection === 'open') {
        console.log('\n✅ Bot berhasil terhubung ke WhatsApp!');
        console.log(`📱 Bot aktif sebagai: ${sock.user.id.split(':')[0]}\n`);
        
        // Tampilkan daftar grup
        try {
          const groups = await sock.groupFetchAllParticipating();
          console.log('📋 DAFTAR GRUP YANG DIIKUTI:');
          Object.keys(groups).forEach(jid => {
            console.log(`   📌 ${groups[jid].subject}`);
            console.log(`      ID: ${jid}\n`);
          });
        } catch (e) {
          console.log('⚠️ Tidak bisa mengambil daftar grup');
        }
        
        // Tanya ingin mulai kirim otomatis?
        const jawaban = await question('🚀 Mulai kirim gambar otomatis ke grup? (y/n): ');
        
        if (jawaban.toLowerCase() === 'y') {
          // Minta ID grup
          const groupId = await question('📝 Masukkan ID grup (contoh: 120363xxxxxxxxx@g.us): ');
          sendImageToGroup(sock, groupId);
        } else {
          console.log('⏸️ Bot standby. Jalankan ulang untuk mengirim gambar');
        }
      }
    });
    
    // Proses pairing code
    if (!sock.authState.creds.registered) {
      console.log('\n🔐 Memulai proses pairing code...');
      const phoneNumber = await question('📱 Masukkan nomor telepon (contoh: 628xxxxxxxxx): ');
      
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      if (!cleanNumber.startsWith('62')) {
        console.log('⚠️ Gunakan format 62 untuk Indonesia');
      }
      
      try {
        console.log('⏳ Meminta kode pairing...');
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`\n✨ KODE PAIRING ANDA: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
        console.log('📱 Masukkan kode tersebut di WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon\n');
      } catch (error) {
        console.error('❌ Gagal mendapatkan pairing code:', error.message);
      }
    }
    
    return sock;
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.log('🔄 Restart dalam 3 detik...');
    await delay(3000);
    startBot();
  }
}

// Fungsi kirim gambar ke grup
async function sendImageToGroup(sock, groupJid) {
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '🤖 BOT WHATSAPP OTOMATIS\n\n📸 Gambar dikirim secara otomatis';
  
  console.log('\n🔄 Memulai pengiriman gambar otomatis...');
  console.log(`📡 Target grup: ${groupJid}`);
  console.log('⏱️ Delay antar kirim: 5 detik');
  console.log('🛑 Tekan Ctrl+C untuk berhenti\n');
  
  let counter = 1;
  
  while (true) {
    try {
      if (!sock.user) {
        console.log('⚠️ Bot terputus');
        break;
      }
      
      await sock.sendMessage(groupJid, {
        image: { url: imageUrl },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter}\n⏰ ${new Date().toLocaleString('id-ID')}`
      });
      
      console.log(`✅ [${counter}] Terkirim - ${new Date().toLocaleTimeString()}`);
      counter++;
      
      await delay(5000);
      
    } catch (error) {
      console.error(`❌ Gagal kirim #${counter}:`, error.message);
      await delay(10000);
    }
  }
}

// Handle exit
process.on('SIGINT', () => {
  console.log('\n\n👋 Bot dimatikan');
  process.exit(0);
});

// Jalankan bot
console.log('🚀 STARTING WHATSAPP BOT...\n');
console.log('📦 Pastikan package sudah terinstall:\n');
console.log('   npm install @whiskeysockets/baileys @hapi/boom pino readline\n');
startBot().catch(console.error);

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

    const { state, saveCreds } = await useMultiFileAuthState('auth');
    const { version } = await fetchLatestBaileysVersion();
    
    console.log(`📡 Menggunakan Baileys version: ${version.join('.')}`);
    
    const sock = makeWASocket({
      version,
      auth: state,
      logger: P({ level: 'error' }), // Ubah ke error biar ga spam
      browser: Browsers.windows('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      patchMessageBeforeSending: (message) => {
        const requiresPatch = !!(
          message.buttonsMessage || 
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {}
                },
                ...message
              }
            }
          };
        }
        return message;
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    // Variable untuk kontrol pengiriman
    let isSendingActive = false;
    let sendImageLoop = null;
    
    // Event koneksi
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ Koneksi terputus, status code:', lastDisconnect.error?.output?.statusCode);
        
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
        
        // Berhentikan loop sebelumnya jika ada
        if (sendImageLoop) {
          clearInterval(sendImageLoop);
        }
        
        // Tanya ingin mulai kirim otomatis?
        const jawaban = await question('🚀 Mulai kirim gambar otomatis ke grup? (y/n): ');
        
        if (jawaban.toLowerCase() === 'y') {
          isSendingActive = true;
          sendImageToGroup(sock);
        } else {
          console.log('⏸️ Bot standby, ketik "start" untuk mulai mengirim');
          
          // Fungsi manual start via console
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
          });
          
          rl.on('line', async (input) => {
            if (input.toLowerCase() === 'start' && !isSendingActive) {
              isSendingActive = true;
              console.log('🎬 Memulai pengiriman otomatis...');
              sendImageToGroup(sock);
              rl.close();
            }
          });
        }
      }
    });
    
    // Proses pairing code
    if (!sock.authState.creds.registered) {
      console.log('\n🔐 Memulai proses pairing code...');
      const phoneNumber = await question('📱 Masukkan nomor telepon (contoh: 628xxxxxxxxx): ');
      
      // Validasi nomor
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      if (!cleanNumber.startsWith('62')) {
        console.log('⚠️ Gunakan format 62 untuk Indonesia (contoh: 6281234567890)');
      }
      
      try {
        console.log('⏳ Meminta kode pairing...');
        const code = await sock.requestPairingCode(cleanNumber);
        console.log(`\n✨ KODE PAIRING ANDA: ${code?.match(/.{1,4}/g)?.join('-') || code}`);
        console.log('📱 Cara menggunakan:');
        console.log('1. Buka WhatsApp di HP');
        console.log('2. Klik titik tiga > Perangkat Tertaut');
        console.log('3. Klik "Tautkan dengan nomor telepon"');
        console.log('4. Masukkan kode di atas\n');
        console.log('⏳ Menunggu koneksi...\n');
      } catch (error) {
        console.error('❌ Gagal mendapatkan pairing code:', error.message);
        console.log('💡 Tips: Pastikan nomor benar dan internet stabil');
      }
    }
    
    return sock;
    
  } catch (error) {
    console.error('❌ Error pada startBot:', error);
    console.log('🔄 Restart dalam 3 detik...');
    await delay(3000);
    startBot();
  }
}

// Fungsi kirim gambar ke grup (otomatis & unlimited)
async function sendImageToGroup(sock) {
  // === KONFIGURASI YANG HARUS DI GANTI ===
  const groupJid = '120363xxxxxxxxx@g.us'; // 🔴 GANTI INI DENGAN ID GRUP ASLI!
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '🤖 BOT WHATSAPP OTOMATIS\n\n📸 Gambar dikirim secara berkala';
  
  // Validasi groupJid
  if (groupJid === '120363xxxxxxxxx@g.us') {
    console.error('\n❌ ERROR: Anda belum mengganti ID grup!');
    console.log('📝 Cara mendapatkan ID grup:');
    console.log('1. Bot akan menampilkan daftar grup saat konek');
    console.log('2. Copy ID grup yang dimulai dengan "120363..."');
    console.log('3. Ganti pada variabel "groupJid" di kode\n');
    
    // Tampilkan daftar grup
    try {
      const groups = await sock.groupFetchAllParticipating();
      console.log('📋 Daftar grup Anda:');
      Object.keys(groups).forEach(jid => {
        console.log(`   - ${groups[jid].subject}: ${jid}`);
      });
    } catch (e) {
      console.log('   Tidak bisa mengambil daftar grup');
    }
    return;
  }
  
  console.log('\n🔄 Memulai pengiriman gambar otomatis ke grup...');
  console.log(`📡 Target grup: ${groupJid}`);
  console.log(`🖼️ URL Gambar: ${imageUrl}`);
  console.log('⏱️ Delay antar kirim: 3-5 detik');
  console.log('🛑 Tekan Ctrl+C untuk berhenti\n');
  
  let counter = 1;
  let errorCount = 0;
  
  // Loop unlimited dengan safety
  while (true) {
    try {
      // Cek koneksi
      if (!sock.user || !sock.ws.readyState === 1) {
        console.log('⚠️ Koneksi terputus, menunggu reconnect...');
        await delay(5000);
        continue;
      }
      
      // Kirim gambar dengan timeout
      const sendPromise = sock.sendMessage(groupJid, {
        image: { url: imageUrl },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter}\n⏰ ${new Date().toLocaleString('id-ID')}`
      });
      
      // Timeout 30 detik
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout 30 detik')), 30000)
      );
      
      await Promise.race([sendPromise, timeoutPromise]);
      
      console.log(`✅ [${counter}] Terkirim - ${new Date().toLocaleTimeString()}`);
      counter++;
      errorCount = 0; // Reset error count
      
      // Delay random 3-7 detik (lebih aman)
      const waitTime = 3000 + Math.random() * 4000;
      await delay(waitTime);
      
    } catch (error) {
      errorCount++;
      console.error(`❌ Gagal kirim #${counter}:`, error.message);
      
      // Jika error karena rate limit, tunggu lebih lama
      if (error.message.includes('rate-overlimit') || error.message.includes('429')) {
        console.log('⚠️ Kena rate limit, jeda 30 detik...');
        await delay(30000);
      } 
      // Jika error terlalu banyak, stop otomatis
      else if (errorCount >= 10) {
        console.log('🛑 Terlalu banyak error, menghentikan pengiriman...');
        console.log('💡 Cek koneksi internet dan ID grup');
        break;
      }
      else {
        await delay(10000); // Jeda 10 detik untuk error lain
      }
    }
  }
}

// Handle exit dengan baik
process.on('SIGINT', () => {
  console.log('\n\n👋 Bot dimatikan. Sampai jumpa!');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.log('🔄 Restart dalam 5 detik...');
  setTimeout(() => startBot(), 5000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// Jalankan bot
console.log('🚀 STARTING WHATSAPP BOT...\n');
startBot().catch(console.error);

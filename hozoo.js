  import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import P from 'pino';
import readline from 'readline';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Fungsi download gambar dari URL ke local
async function downloadImage(url, filepath) {
  const writer = createWriteStream(filepath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Daftar grup (akan diisi otomatis)
let groupList = [];

// Fungsi utama bot
async function startBot() {
  try {
    if (!existsSync('auth')) {
      mkdirSync('auth');
    }
    
    if (!existsSync('temp')) {
      mkdirSync('temp');
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
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60000
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
        
        // Ambil semua grup
        try {
          const groups = await sock.groupFetchAllParticipating();
          groupList = Object.keys(groups).map(jid => ({
            id: jid,
            name: groups[jid].subject
          }));
          
          console.log('📋 DAFTAR GRUP YANG DIIKUTI:');
          groupList.forEach((group, index) => {
            console.log(`   ${index + 1}. ${group.name}`);
            console.log(`      ID: ${group.id}\n`);
          });
          
          if (groupList.length === 0) {
            console.log('⚠️ Bot tidak mengikuti grup manapun!');
            console.log('💡 Tambahkan bot ke grup terlebih dahulu\n');
            return;
          }
          
          // Tanya mode pengiriman
          console.log('\n=== PILIH MODE PENGIRIMAN ===');
          console.log('1. Kirim ke semua grup (random urutan)');
          console.log('2. Kirim ke grup tertentu saja');
          console.log('3. Kirim random ke 1 grup setiap kali\n');
          
          const mode = await question('Pilih mode (1/2/3): ');
          
          if (mode === '1') {
            // Mode semua grup
            console.log('\n🚀 Memulai pengiriman ke SEMUA GRUP secara bergantian...');
            await sendImageToAllGroups(sock);
          } else if (mode === '2') {
            // Mode grup tertentu
            console.log('\n📝 Pilih grup:');
            groupList.forEach((group, index) => {
              console.log(`   ${index + 1}. ${group.name}`);
            });
            const pilihan = await question('\nMasukkan nomor grup: ');
            const selectedGroup = groupList[parseInt(pilihan) - 1];
            if (selectedGroup) {
              console.log(`\n🚀 Memulai pengiriman ke grup: ${selectedGroup.name}`);
              await sendImageToSpecificGroup(sock, selectedGroup.id);
            }
          } else if (mode === '3') {
            // Mode random
            console.log('\n🎲 Memulai pengiriman RANDOM ke 1 grup setiap kali...');
            await sendImageRandomGroup(sock);
          } else {
            console.log('❌ Mode tidak valid!');
          }
          
        } catch (e) {
          console.error('❌ Gagal mengambil daftar grup:', e.message);
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

// Fungsi kirim gambar ke SEMUA GRUP (bergantian)
async function sendImageToAllGroups(sock) {
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '🤖 BOT WHATSAPP OTOMATIS\n\n📸 Gambar dikirim secara otomatis';
  
  // Download gambar sekali untuk reuse
  const localPath = join(__dirname, 'temp', 'image.jpg');
  console.log('📥 Mendownload gambar...');
  await downloadImage(imageUrl, localPath);
  console.log('✅ Gambar siap dikirim\n');
  
  console.log(`🎯 Target: ${groupList.length} grup`);
  console.log('🔄 Mode: Bergantian ke semua grup');
  console.log('⏱️ Delay: 10 detik antar pengiriman');
  console.log('🛑 Tekan Ctrl+C untuk berhenti\n');
  
  let counter = 1;
  let groupIndex = 0;
  
  while (true) {
    try {
      if (!sock.user) {
        console.log('⚠️ Bot terputus');
        break;
      }
      
      const targetGroup = groupList[groupIndex % groupList.length];
      console.log(`📤 [${counter}] Mengirim ke: ${targetGroup.name}...`);
      
      // Kirim gambar dari file local (lebih reliable)
      await sock.sendMessage(targetGroup.id, {
        image: { url: localPath },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter}\n👥 Grup: ${targetGroup.name}\n⏰ ${new Date().toLocaleString('id-ID')}`
      });
      
      console.log(`✅ [${counter}] Berhasil ke ${targetGroup.name} - ${new Date().toLocaleTimeString()}`);
      counter++;
      groupIndex++;
      
      // Delay 10 detik
      await delay(10000);
      
    } catch (error) {
      console.error(`❌ Gagal kirim #${counter}:`, error.message);
      await delay(15000);
    }
  }
}

// Fungsi kirim gambar ke 1 GRUP TERTENTU (unlimited)
async function sendImageToSpecificGroup(sock, groupId) {
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '🤖 BOT WHATSAPP OTOMATIS\n\n📸 Gambar dikirim secara otomatis';
  
  const localPath = join(__dirname, 'temp', 'image.jpg');
  console.log('📥 Mendownload gambar...');
  await downloadImage(imageUrl, localPath);
  console.log('✅ Gambar siap dikirim\n');
  
  const group = groupList.find(g => g.id === groupId);
  console.log(`🎯 Target grup: ${group?.name || groupId}`);
  console.log('🔄 Mode: Unlimited (loop terus)');
  console.log('⏱️ Delay: 7 detik antar kirim');
  console.log('🛑 Tekan Ctrl+C untuk berhenti\n');
  
  let counter = 1;
  
  while (true) {
    try {
      if (!sock.user) {
        console.log('⚠️ Bot terputus');
        break;
      }
      
      await sock.sendMessage(groupId, {
        image: { url: localPath },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter}\n⏰ ${new Date().toLocaleString('id-ID')}`
      });
      
      console.log(`✅ [${counter}] Terkirim - ${new Date().toLocaleTimeString()}`);
      counter++;
      
      await delay(7000);
      
    } catch (error) {
      console.error(`❌ Gagal kirim #${counter}:`, error.message);
      await delay(10000);
    }
  }
}

// Fungsi kirim gambar RANDOM ke 1 grup setiap kali
async function sendImageRandomGroup(sock) {
  const imageUrl = 'https://i.ibb.co.com/WptdtTd3/New-Project-1-7-A4129-F.png';
  const caption = '🤖 BOT WHATSAPP OTOMATIS\n\n📸 Gambar dikirim secara otomatis';
  
  const localPath = join(__dirname, 'temp', 'image.jpg');
  console.log('📥 Mendownload gambar...');
  await downloadImage(imageUrl, localPath);
  console.log('✅ Gambar siap dikirim\n');
  
  console.log(`🎲 Mode: Random dari ${groupList.length} grup`);
  console.log('🔄 Setiap kirim pilih grup berbeda');
  console.log('⏱️ Delay: 8 detik antar kirim');
  console.log('🛑 Tekan Ctrl+C untuk berhenti\n');
  
  let counter = 1;
  
  while (true) {
    try {
      if (!sock.user) {
        console.log('⚠️ Bot terputus');
        break;
      }
      
      // Pilih grup random
      const randomIndex = Math.floor(Math.random() * groupList.length);
      const targetGroup = groupList[randomIndex];
      
      console.log(`🎲 [${counter}] Random pilih: ${targetGroup.name}`);
      
      await sock.sendMessage(targetGroup.id, {
        image: { url: localPath },
        caption: `${caption}\n\n📨 Pengiriman ke-${counter}\n🎲 Grup random: ${targetGroup.name}\n⏰ ${new Date().toLocaleString('id-ID')}`
      });
      
      console.log(`✅ [${counter}] Terkirim ke ${targetGroup.name} - ${new Date().toLocaleTimeString()}`);
      counter++;
      
      await delay(8000);
      
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
startBot().catch(console.error);

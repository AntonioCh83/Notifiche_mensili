// Script per inviare notifiche mensili basate su dati Excel
// Installare le dipendenze con:
// npm install node-cron xlsx nodemailer whatsapp-web.js dotenv

require('dotenv').config();
const cron = require('node-cron');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Configurazione
const CONFIG = {
  // Percorso del file Excel
  excelFile: path.join(__dirname, 'ProvaNotifiche.xlsx'),
  
  // Nome del foglio Excel che contiene i dati
  sheetName: 'notifiche',
  
  // Colonne necessarie nel file Excel
  columns: {
    email: 'Email',          // Colonna con le email
    telefono: 'Telefono',    // Colonna con i numeri di telefono (formato: 39XXXXXXXXXX)
    nome: 'Nome',            // Colonna con i nomi degli utenti
    dati: 'Dati',            // Colonna con i dati personalizzati da inviare
    canale: 'Canale'         // Colonna che indica il canale preferito ('email' o 'whatsapp')
  },
  
  // Configurazione email
  email: {
    host: process.env.EMAIL_HOST || 'smtp.example.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER || 'username@example.com',
      pass: process.env.EMAIL_PASS || 'password'
    },
    from: process.env.EMAIL_FROM || 'Sistema Notifiche <notifiche@example.com>',
    subject: 'Notifica mensile capitazioni'
  }
};

// Logger semplice
const logger = {
  info: (message) => console.log(`[INFO] ${new Date().toISOString()}: ${message}`),
  error: (message, error) => console.error(`[ERROR] ${new Date().toISOString()}: ${message}`, error || '')
};

// Inizializzazione client WhatsApp
let whatsappClient = null;

function initializeWhatsApp() {
  logger.info('Inizializzazione client WhatsApp...');
  
  whatsappClient = new Client({
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  whatsappClient.on('qr', (qr) => {
    // Genera e mostra il codice QR per autenticarsi a WhatsApp Web
    logger.info('Scansiona questo codice QR con WhatsApp sul tuo telefono:');
    qrcode.generate(qr, { small: true });
  });

  whatsappClient.on('ready', () => {
    logger.info('Client WhatsApp connesso e pronto!');
  });

  whatsappClient.on('disconnected', () => {
    logger.info('Client WhatsApp disconnesso. Riavvio in corso...');
    whatsappClient.initialize();
  });

  whatsappClient.initialize();
}

// Configurazione del trasportatore email
const emailTransporter = nodemailer.createTransport(CONFIG.email);

// Funzione per leggere i dati degli utenti dal file Excel
function leggiUtentiDaExcel() {
  try {
    // Verifica se il file esiste
    if (!fs.existsSync(CONFIG.excelFile)) {
      throw new Error(`Il file Excel ${CONFIG.excelFile} non esiste!`);
    }
    
    // Legge il file Excel
    const workbook = XLSX.readFile(CONFIG.excelFile);
    
    // Verifica se il foglio specificato esiste
    if (!workbook.SheetNames.includes(CONFIG.sheetName)) {
      throw new Error(`Il foglio "${CONFIG.sheetName}" non esiste nel file Excel!`);
    }
    
    // Ottiene i dati dal foglio specificato
    const worksheet = workbook.Sheets[CONFIG.sheetName];
    const utenti = XLSX.utils.sheet_to_json(worksheet);
    
    logger.info(`Letti ${utenti.length} utenti dal file Excel.`);
    return utenti;
  } catch (error) {
    logger.error('Errore durante la lettura del file Excel:', error);
    return [];
  }
}

// Funzione per inviare una email
async function inviaEmail(destinatario, nome, dati) {
  try {
    const emailHtml = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { padding: 20px; max-width: 600px; margin: 0 auto; }
            .header { background-color: #f5f5f5; padding: 10px; border-radius: 5px; }
            .content { padding: 20px 0; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Notifica Mensile</h2>
            </div>
            <div class="content">
              <h4>Caro ${nome},</h4>
              <h4>Il tuo resoconto mensile</h4>
              <p>Ultimo mese saldato:</p>
              <div style="background-color: #f9f9f9; padding: 15px; border: 3px solid #007bff; margin: 15px 0;">
                ${dati}
              </div>
              <p>Saluti.</p>
            </div>
            <div class="footer">
              <p>Questa è un'email automatica, si prega di non rispondere.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const info = await emailTransporter.sendMail({
      from: CONFIG.email.from,
      to: destinatario,
      subject: CONFIG.email.subject,
      html: emailHtml
    });

    logger.info(`Email inviata a ${destinatario}: ${info.messageId}`);
    return true;
  } catch (error) {
    logger.error(`Errore durante l'invio dell'email a ${destinatario}:`, error);
    return false;
  }
}

// Funzione per inviare un messaggio WhatsApp
async function inviaWhatsApp(numero, nome, dati) {
  try {
    if (!whatsappClient || !whatsappClient.info) {
      throw new Error('Client WhatsApp non inizializzato correttamente');
    }

    // Formato del messaggio WhatsApp
    const messaggio = `
*Notifica Mensile*

Gentile ${nome},

Ecco la tua notifica mensile personalizzata:

_${dati}_

Grazie per l'attenzione.
    `.trim();

    // Invia il messaggio
    // Il numero deve essere nel formato internazionale senza il "+" (es: 39XXXXXXXXXX)
    await whatsappClient.sendMessage(`${numero}@c.us`, messaggio);
    
    logger.info(`Messaggio WhatsApp inviato a ${numero}`);
    return true;
  } catch (error) {
    logger.error(`Errore durante l'invio del messaggio WhatsApp a ${numero}:`, error);
    return false;
  }
}

// Funzione principale che invia le notifiche mensili
async function inviaNotificheMensili() {
  logger.info('Avvio invio notifiche mensili...');
  
  // Legge gli utenti dal file Excel
  const utenti = leggiUtentiDaExcel();
  
  if (utenti.length === 0) {
    logger.error('Nessun utente trovato o errore nella lettura del file Excel.');
    return;
  }
  
  // Contatori per il report finale
  let emailInviate = 0;
  let whatsappInviati = 0;
  let errori = 0;
  
  // Processa ogni utente
  for (const utente of utenti) {
    const nome = utente[CONFIG.columns.nome] || 'Utente';
    const dati = utente[CONFIG.columns.dati] || 'Nessun dato disponibile';
    const canale = utente[CONFIG.columns.canale]?.toLowerCase() || 'email';
    
    try {
      if (canale === 'email') {
        const email = utente[CONFIG.columns.email];
        if (!email) {
          logger.error(`Utente ${nome} non ha un indirizzo email valido.`);
          errori++;
          continue;
        }
        
        const success = await inviaEmail(email, nome, dati);
        if (success) emailInviate++;
        else errori++;
      } 
      else if (canale === 'whatsapp') {
        const telefono = utente[CONFIG.columns.telefono];
        if (!telefono) {
          logger.error(`Utente ${nome} non ha un numero di telefono valido.`);
          errori++;
          continue;
        }
        
        const success = await inviaWhatsApp(telefono, nome, dati);
        if (success) whatsappInviati++;
        else errori++;
      }
      else {
        logger.error(`Canale "${canale}" non supportato per l'utente ${nome}.`);
        errori++;
      }
      
      // Piccola pausa tra gli invii per evitare rate limiting
      await new Promise(resolve => setTimeout(resolve, 300000));
    } catch (error) {
      logger.error(`Errore nel processare l'utente ${nome}:`, error);
      errori++;
    }
  }
  
  // Report finale
  logger.info('Invio notifiche mensili completato.');
  logger.info(`Statistiche: ${emailInviate} email inviate, ${whatsappInviati} messaggi WhatsApp inviati, ${errori} errori.`);
}

// Funzione per avviare il programma
function avviaProgramma() {
  logger.info('Sistema di notifiche mensili avviato.');
  
  // Inizializza WhatsApp se necessario
  initializeWhatsApp();
  
  // Test di connessione SMTP
  emailTransporter.verify()
    .then(() => logger.info('Connessione SMTP verificata con successo.'))
    .catch(error => logger.error('Errore nella connessione SMTP:', error));
  
  // Pianifica l'esecuzione mensile (il primo giorno del mese alle 9:00)
  // Formato cron: minuto ora giorno-del-mese mese giorno-della-settimana
  cron.schedule('0 9 1 * *', inviaNotificheMensili);
  
  // Opzionale: esegui immediatamente per test (commentare in produzione)
  setTimeout(inviaNotificheMensili, 30000);
  
  logger.info('Programmazione completata. In attesa del prossimo invio mensile...');
}

// Avvia il programma
avviaProgramma();
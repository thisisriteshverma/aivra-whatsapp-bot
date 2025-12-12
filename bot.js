import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import express from "express";

let sock;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false   // Render can't print QR, so we handle manually
    });

    sock.ev.on("connection.update", ({ connection, qr }) => {
        if (qr) {
            console.log("\n📱 Scan this QR to connect WhatsApp:\n");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ WhatsApp Bot Connected Successfully!");
        }

        if (connection === "close") {
            console.log("❌ Bot disconnected. Reconnecting...");
            startBot();
        }
    });

    sock.ev.on("creds.update", saveCreds);
}

await startBot();

// --- EXPRESS API ---
const app = express();
app.use(express.json());

// send WhatsApp message
app.post("/send", async (req, res) => {
    try {
        const { number, message } = req.body;

        if (!number || !message) {
            return res.json({ success: false, error: "number and message required" });
        }

        const jid = number + "@s.whatsapp.net";
        await sock.sendMessage(jid, { text: message });

        console.log(`📨 Sent to ${number}: ${message}`);
        res.json({ success: true });

    } catch (err) {
        console.error("❌ Error sending message:", err);
        res.json({ success: false, error: err.toString() });
    }
});

// ---- IMPORTANT FOR RENDER ----
const PORT = process.env.PORT || 3000;

// Prevent Render from sleeping (keep-alive)
setInterval(() => {}, 10000);

app.listen(PORT, () => {
    console.log(`\n🚀 Aivra WhatsApp API running on PORT ${PORT}\n`);
});

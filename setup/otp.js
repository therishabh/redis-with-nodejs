// =============================================================================
// otp.js -> OTP (One Time Password) verification ke saare routes yahan hain
// =============================================================================
// Idea: Phone number verify karne ke liye ek 6-digit OTP generate karke Redis
// me store karte hain (chhoti si expiry ke saath), user ko wo OTP kisi tarah
// bheja jata hai (yahan hum demo ke liye console par print kar rahe hain —
// real app me isi jagah SMS gateway, jaise Twilio/MSG91, call hota), aur
// user jab wapas wahi OTP submit karta hai to hum use Redis se match karke
// verify karte hain.
//
// Redis is use case ke liye perfect hai kyunki:
//   - OTP sirf thodi der ke liye valid rehna chahiye -> Redis ki built-in
//     "expiry" (TTL) feature isके liye bani hi hai.
//   - Expire hote hi Redis khud hi key delete kar deta hai, humein manually
//     "purana OTP saaf karo" wala cron/cleanup job nahi likhna padta.
//
// Basic flow ke upar, ye production-relevant safeguards bhi add kiye hain
// (ye cheezein har backend developer ko OTP system banate waqt pata honi
// chahiye):
//   1. Resend cooldown  -> Jab tak purana OTP active hai, naya OTP generate
//                          nahi hone dete (Redis "NX" flag se atomically
//                          check + set ek hi step me hota hai).
//   2. Max verify attempts -> Ek OTP par unlimited galat guesses allow nahi
//                          karte, warna attacker brute-force se 6-digit OTP
//                          (sirf 10 lakh combinations) crack kar sakta hai.
//   3. Phone normalization -> "+919876543210", "919876543210", "9876543210"
//                          teeno same insaan ke number hain — inhe ek hi
//                          canonical form me convert karte hain, warna Redis
//                          me alag-alag keys ban jayengi aur OTP kabhi match
//                          hi nahi hoga.
//
// Iske liye 3 routes hain:
//   POST /otp             -> phone number do, naya OTP generate + send ho
//                             jayega (Redis me 60 second expiry ke saath)
//   POST /otp/verify       -> phone + otp do, check hoga ki sahi hai ya nahi
//   GET  /otp/:phone/ttl   -> is phone ke liye OTP abhi kitni der aur valid
//                             hai (seconds me), ye batata hai
// =============================================================================

import { Router } from 'express';

// OTP ka expiry time (seconds me). 60 second matlab user ko 1 minute ke
// andar OTP submit karna hoga, warna wo Redis se apne aap delete ho jayega.
const OTP_EXPIRY_SECONDS = 60;

// Ek OTP ke against zyada se zyada kitni baar galat guess allow hai. Isse
// zyada galat attempts hone par us OTP ko turant invalidate kar dete hain,
// taaki attacker limited time me sirf itni hi baar guess kar sake (brute
// force practically impossible ho jata hai).
const MAX_VERIFY_ATTEMPTS = 5;

// Redis me har phone number ke OTP ko is pattern se key banake store karte
// hain, jaise "otp:9876543210". Isse ek hi Redis instance me kayi cheezon
// (banner, otp, etc.) ke keys mix hoke aapas me clash nahi karte.
function getOtpKey(phone) {
    return `otp:${phone}`;
}

// Har phone ke failed verify attempts ka count is alag key me rakhte hain,
// taaki OTP ki value wali key se ye mix na ho.
function getAttemptsKey(phone) {
    return `otp:attempts:${phone}`;
}

// Ye function ek 6-digit random number banata hai (100000 se 999999 ke
// beech), string ke roop me (kyunki OTP me leading zero bhi valid hota hai,
// aur hum use text ki tarah hi treat kar rahe hain).
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Phone number ko ek "canonical" (standard) form me normalize karte hain,
// taaki user chahe "+91 98765 43210", "919876543210", ya "9876543210" kuch
// bhi de, hum hamesha usi 10-digit number par store/verify karein.
// Steps:
//   1. Saare non-digit characters (spaces, "+", "-", etc.) hata dete hain.
//   2. Sirf aakhri 10 digits rakhte hain (country code jaisa "91" prefix
//      apne aap chhoot jata hai).
// Agar 10 digits se kam bache, to ye invalid number hai -> null return
// karte hain.
function normalizePhone(phone) {
    if (!phone) return null;

    const digitsOnly = String(phone).replace(/\D/g, '');

    if (digitsOnly.length < 10) {
        return null;
    }

    return digitsOnly.slice(-10);
}

// Factory function -> Redis client bahar (index.js) se pass karwate hain,
// taaki ye file apna alag Redis connection na banaye, balki shared
// connection hi reuse kare.
export default function otpRouter(redis) {
    const router = Router();

    // -------------------------------------------------------------------
    // @route   POST /otp
    // @desc    Diye gaye phone number ke liye naya OTP generate karta hai
    //          aur Redis me 60 second ki expiry ke saath store karta hai.
    //          Agar us phone ke liye pehle se ek OTP active hai (abhi
    //          expire nahi hua), to naya OTP generate nahi hota — resend
    //          cooldown enforce hota hai.
    // @body    { "phone": "9876543210" }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/otp', async (req, res) => {
        try {
            const phone = normalizePhone(req.body.phone);

            // Basic validation: phone number zaroori hai aur valid (kam se
            // kam 10 digits ka) hona chahiye, warna kis ke naam par OTP
            // generate karein pata hi nahi chalega.
            if (!phone) {
                return res.status(400).json({ error: 'A valid phone number is required' });
            }

            const otp = generateOtp();
            const key = getOtpKey(phone);

            // redis.set(key, value, 'EX', seconds, 'NX') -> teen cheezein
            // ek hi atomic operation me ho rahi hain:
            //   - "EX seconds" -> key ko itne seconds baad apne aap expire
            //     kar do.
            //   - "NX" (Not eXists) -> ye value SIRF tabhi set karo jab key
            //     pehle se exist na karti ho. Agar key already hai (matlab
            //     purana OTP abhi expire nahi hua), to kuch bhi set nahi
            //     hoga aur Redis reply me "null" milega.
            // Isse "resend cooldown" atomically enforce hota hai — do
            // parallel requests bhi aane par sirf ek hi jeetega, race
            // condition nahi hogi.
            const result = await redis.set(key, otp, 'EX', OTP_EXPIRY_SECONDS, 'NX');

            if (result === null) {
                // Matlab is phone ke liye ek OTP already active hai. User
                // ko bataते hain ki kitni der baad wo dobara try kar sakta
                // hai (existing OTP ka baaki TTL).
                const remainingTtl = await redis.ttl(key);
                return res.status(429).json({
                    error: 'An OTP was already sent recently. Please wait before requesting a new one.',
                    retryAfterSeconds: remainingTtl > 0 ? remainingTtl : OTP_EXPIRY_SECONDS,
                });
            }

            // Naya OTP successfully set hua hai -> agar purane kisi verify
            // attempt ka leftover counter bacha ho (edge case), use bhi
            // saaf kar dete hain, taaki naya OTP fresh 5 attempts ke saath
            // start ho.
            await redis.del(getAttemptsKey(phone));

            // NOTE: Yahan par real production app me hum kisi SMS gateway
            // (jaise Twilio, MSG91, etc.) ko call karke ye OTP user ke phone
            // par bhejte. Abhi ke liye demo/learning purpose se hum use
            // sirf server console par print kar rahe hain.
            //
            // IMPORTANT: Production me OTP ki value kabhi bhi console,
            // logs, ya monitoring tools me print/store nahi karni chahiye —
            // sensitive data hai, aur agar logs kahin leak ho jayein to OTP
            // bhi expose ho jayega. Yahan sirf learning ke liye print kar
            // rahe hain.
            console.log(`OTP for ${phone}: ${otp}`);

            res.json({
                success: true,
                message: `OTP sent successfully. It will expire in ${OTP_EXPIRY_SECONDS} seconds.`,
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // -------------------------------------------------------------------
    // @route   POST /otp/verify
    // @desc    User dwara diya gaya OTP, Redis me store hui value se match
    //          karke verify karta hai. Ek OTP par sirf limited (5) galat
    //          attempts allow hain — usse zyada hone par OTP invalidate ho
    //          jata hai aur user ko naya OTP mangwana padega.
    // @body    { "phone": "9876543210", "otp": "123456" }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/otp/verify', async (req, res) => {
        try {
            const phone = normalizePhone(req.body.phone);
            const { otp } = req.body;

            if (!phone || !otp) {
                return res.status(400).json({ error: 'A valid phone and otp are required' });
            }

            const key = getOtpKey(phone);
            const attemptsKey = getAttemptsKey(phone);

            const storedOtp = await redis.get(key);

            // storedOtp null hoga agar:
            //   - is phone ke liye OTP kabhi generate hi nahi hua, YA
            //   - OTP 60 second ki expiry ke baad apne aap delete ho chuka,
            //     YA
            //   - too many wrong attempts ki wajah se hum khud isse delete
            //     kar chuke hain (neeche dekho)
            if (!storedOtp) {
                return res.status(400).json({ error: 'OTP expired or not requested' });
            }

            if (storedOtp !== otp) {
                // Galat OTP -> attempts counter ko 1 se badhate hain.
                // redis.incr() agar key exist nahi karti to use 0 maan ke
                // 1 kar deta hai (aur naya bana deta hai), warna existing
                // value +1 kar deta hai.
                const attempts = await redis.incr(attemptsKey);

                if (attempts === 1) {
                    // Attempts counter pehli baar bana hai -> isko bhi OTP
                    // jitni hi expiry de dete hain, taaki OTP expire hote
                    // hi attempts count bhi apne aap saaf ho jaye.
                    await redis.expire(attemptsKey, OTP_EXPIRY_SECONDS);
                }

                if (attempts >= MAX_VERIFY_ATTEMPTS) {
                    // Bahut zyada galat attempts ho chuke -> is OTP ko
                    // turant invalidate kar dete hain (attacker ko aur
                    // guesses na milein). User ko ab naya OTP mangwana
                    // padega.
                    await redis.del(key);
                    await redis.del(attemptsKey);
                    return res.status(429).json({
                        error: 'Too many incorrect attempts. Please request a new OTP.',
                    });
                }

                return res.status(400).json({
                    error: 'Invalid OTP',
                    attemptsRemaining: MAX_VERIFY_ATTEMPTS - attempts,
                });
            }

            // OTP sahi hai -> ab isse Redis se turant delete kar dete hain,
            // taaki wahi OTP dobara reuse (replay) na ho sake. Ek OTP sirf
            // ek hi baar successfully verify hona chahiye. Attempts
            // counter bhi saath me saaf kar dete hain.
            await redis.del(key);
            await redis.del(attemptsKey);

            res.json({ success: true, message: 'OTP verified successfully' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // -------------------------------------------------------------------
    // @route   GET /otp/:phone/ttl
    // @desc    Is phone number ke current OTP ka TTL (Time To Live) batata
    //          hai — matlab OTP abhi kitne seconds aur valid rahega.
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/otp/:phone/ttl', async (req, res) => {
        try {
            const phone = normalizePhone(req.params.phone);

            if (!phone) {
                return res.status(400).json({ error: 'A valid phone number is required' });
            }

            // redis.ttl(key) seconds me batata hai key kitni der aur zinda
            // rahegi:
            //   -2 -> key exist hi nahi karti (OTP generate hi nahi hua,
            //         ya pehle hi expire ho chuka)
            //   -1 -> key hai lekin uski koi expiry set nahi hai
            //   >=0 -> itne seconds baad ye key expire ho jayegi
            const ttl = await redis.ttl(getOtpKey(phone));

            if (ttl === -2) {
                return res.status(404).json({ error: 'No active OTP found for this phone number' });
            }

            res.json({ phone, ttl });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Configured router waapas bhej dete hain, jise index.js
    // "app.use(otpRouter(redis))" se mount karta hai.
    return router;
}

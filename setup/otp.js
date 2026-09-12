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

// Redis me har phone number ke OTP ko is pattern se key banake store karte
// hain, jaise "otp:9876543210". Isse ek hi Redis instance me kayi cheezon
// (banner, otp, etc.) ke keys mix hoke aapas me clash nahi karte.
function getOtpKey(phone) {
    return `otp:${phone}`;
}

// Ye function ek 6-digit random number banata hai (100000 se 999999 ke
// beech), string ke roop me (kyunki OTP me leading zero bhi valid hota hai,
// aur hum use text ki tarah hi treat kar rahe hain).
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
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
    // @body    { "phone": "9876543210" }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/otp', async (req, res) => {
        try {
            const { phone } = req.body;

            // Basic validation: phone number zaroori hai, warna kis ke
            // naam par OTP generate karein pata hi nahi chalega.
            if (!phone) {
                return res.status(400).json({ error: 'Phone number is required' });
            }

            const otp = generateOtp();

            // redis.set(key, value, 'EX', seconds) -> "EX" flag Redis ko
            // batata hai ki is key ko itne seconds baad apne aap expire
            // (delete) kar dena. Isse hume manually kabhi bhi purana OTP
            // delete karne ki zaroorat nahi padegi.
            await redis.set(getOtpKey(phone), otp, 'EX', OTP_EXPIRY_SECONDS);

            // NOTE: Yahan par real production app me hum kisi SMS gateway
            // (jaise Twilio, MSG91, etc.) ko call karke ye OTP user ke phone
            // par bhejte. Abhi ke liye demo/learning purpose se hum use
            // sirf server console par print kar rahe hain.
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
    //          karke verify karta hai.
    // @body    { "phone": "9876543210", "otp": "123456" }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/otp/verify', async (req, res) => {
        try {
            const { phone, otp } = req.body;

            if (!phone || !otp) {
                return res.status(400).json({ error: 'Both phone and otp are required' });
            }

            const key = getOtpKey(phone);
            const storedOtp = await redis.get(key);

            // storedOtp null hoga agar:
            //   - is phone ke liye OTP kabhi generate hi nahi hua, YA
            //   - OTP 60 second ki expiry ke baad apne aap delete ho chuka
            if (!storedOtp) {
                return res.status(400).json({ error: 'OTP expired or not requested' });
            }

            if (storedOtp !== otp) {
                return res.status(400).json({ error: 'Invalid OTP' });
            }

            // OTP sahi hai -> ab isse Redis se turant delete kar dete hain,
            // taaki wahi OTP dobara reuse (replay) na ho sake. Ek OTP sirf
            // ek hi baar successfully verify hona chahiye.
            await redis.del(key);

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
            // ":phone" URL me ek dynamic segment (route param) hai, jiski
            // value "req.params.phone" se milti hai. Jaise
            // GET /otp/9876543210/ttl call karne par phone = "9876543210".
            const { phone } = req.params;

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

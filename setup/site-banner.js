// =============================================================================
// site-banner.js -> Site Banner ke saare routes yahan hain
// =============================================================================
// Idea: Home page (ya kisi bhi page) par ek "banner" dikhana hai (jaise
// "Sale live hai!" ya "Site maintenance chal raha hai"). Ye banner Redis me
// store hota hai (fast read/write ke liye), na ki MongoDB me — kyunki banner
// baar baar read hota hai aur data chhota + temporary type ka hota hai.
//
// Iske liye 4 routes hain:
//   GET    /banner         -> current banner dikhao
//   POST   /banner         -> naya banner set/update karo
//   DELETE /banner         -> banner hata do
//   GET    /banner/exists  -> sirf check karo banner set hai ya nahi
//
// Express ka "Router" use karke ye saare routes ek chhoti, alag file me
// rakhe hain (standard modular pattern), taaki index.js chhota/clean rahe.
// =============================================================================

import { Router } from 'express';

// Redis me banner is exact key ke naam se store hota hai. Ek jagah define
// karke reuse kar rahe hain, taaki spelling mistake se do alag keys na ban
// jayein.
const BANNER_KEY = 'site:banner';

// Ye function khud Router return nahi karta seedha — balki ek "factory
// function" hai jo Redis client (redis) accept karti hai aur uske basis par
// ek Router banati hai. Isse index.js apna shared Redis connection isme pass
// kar sakta hai, aur ye file apna alag/naya Redis connection nahi banati.
export default function siteBannerRouter(redis) {
    // Router ek mini Express app jaisa hota hai — apne alag routes define
    // karne deta hai, jinhe baad me main app me "mount" (app.use) kiya jata
    // hai.
    const router = Router();

    // -------------------------------------------------------------------
    // @route   GET /banner
    // @desc    Current banner fetch karo
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/banner', async (req, res) => {
        try {
            // Redis me hum banner ko JSON.stringify karke (as a string)
            // save karte hain, kyunki Redis directly object/array store
            // nahi kar sakta — sab kuch string ke roop me hi store hota
            // hai.
            const banner = await redis.get(BANNER_KEY);
            if (banner) {
                // Isliye read karte waqt wapas JSON.parse karke asli
                // object me convert kar rahe hain.
                res.json({ banner: JSON.parse(banner) });
            } else {
                // redis.get() null return karta hai agar key exist hi
                // nahi karti (matlab abhi tak koi banner set nahi hua).
                res.status(404).json({ error: 'Banner not found' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // -------------------------------------------------------------------
    // @route   POST /banner
    // @desc    Naya banner set karo (ya purane ko overwrite karo)
    // @body    { "message": "...", "color": "..." }
    // @access  Public
    // -------------------------------------------------------------------
    router.post('/banner', async (req, res) => {
        try {
            // req.body tabhi milega jab index.js me "app.use(express.json())"
            // middleware laga ho — wahi incoming JSON body ko parse karke
            // yahan available karwata hai.
            const { message, color } = req.body;

            // Basic validation: dono fields zaroori hain, warna galat/
            // incomplete banner save ho jayega.
            if (!message || !color) {
                return res.status(400).json({ error: 'Both message and color are required' });
            }

            const bannerData = { message, color };

            // redis.set(key, value) -> value hamesha string hi honi
            // chahiye, isliye object ko JSON.stringify kar rahe hain.
            // Note: Ye key ki purani value ko poori tarah overwrite kar
            // deta hai (fir se set karna = update karna).
            await redis.set(BANNER_KEY, JSON.stringify(bannerData));
            res.json({ success: true, banner: bannerData });
        }catch(error) {
            res.status(500).json({ error : error.message})
        }
    })

    // -------------------------------------------------------------------
    // @route   DELETE /banner
    // @desc    Banner hata do (Redis se key delete karo)
    // @access  Public
    // -------------------------------------------------------------------
    router.delete('/banner', async (req, res) => {
        try {
            // redis.del() us key ko delete kitni successfully hui, uska
            // count return karta hai:
            //   1 -> key mili aur delete ho gayi
            //   0 -> key already exist hi nahi karti thi
            const result = await redis.del(BANNER_KEY);
            if (result === 1) {
                res.json({ success: true, message: 'Banner deleted' });
            } else {
                res.status(404).json({ error: 'Banner not found' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // -------------------------------------------------------------------
    // @route   GET /banner/exists
    // @desc    Sirf ye check karo ki banner set hai ya nahi (bina actual
    //          data fetch/parse kiye — halka/fast check ke liye)
    // @access  Public
    // -------------------------------------------------------------------
    router.get('/banner/exists', async (req, res) => {
        try {
            // redis.exists() batata hai key present hai ya nahi:
            //   1 -> key exist karti hai
            //   0 -> key exist nahi karti
            const exists = await redis.exists(BANNER_KEY);
            res.json({ exists: exists === 1 });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Ye configured router waapas bhej dete hain, jise index.js
    // "app.use(siteBannerRouter(redis))" se mount karta hai.
    return router;
}

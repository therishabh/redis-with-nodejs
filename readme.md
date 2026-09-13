# Chai aur Redis - 02 Setup

Ye ek learning project hai jisme hum seekh rahe hain ki **Redis** aur
**MongoDB** ko Docker ke through kaise setup karte hain, aur unhe ek simple
**Express (Node.js)** app se kaise connect karte hain.

## Project Structure

```
02-setup/
├── docker-compose.yml   # Redis + MongoDB containers ki configuration
├── package.json         # Node dependencies aur scripts
├── readme.md            # Ye file
└── setup/
    ├── index.js         # Express server ka entry point
    ├── site-banner.js   # "/banner" routes ka logic (Express Router)
    └── otp.js           # "/otp" routes ka logic (Express Router)
```

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — running
  hona chahiye (menu bar me whale icon)

## Setup - Step by Step

### 1. Dependencies install karo

Root folder (`02-setup`) me:

```bash
npm install
```

### 2. Docker containers (Redis + MongoDB) start karo

Docker Desktop app open/running hona chahiye, uske baad:

```bash
docker compose up -d
```

- `-d` (detached) mode me containers background me chalte hain.
- Isse do containers start honge:
  - `chai-and-redis` -> Redis, port `6379` par
  - `chai-and-mongo` -> MongoDB, port `27017` par
- Dono containers Docker Desktop me ek group ke andar dikhenge, jiska naam
  hai `chai-aur-redis-setup` (ye `docker-compose.yml` ke top-level `name:`
  se aata hai).

Containers ka status check karne ke liye:

```bash
docker compose ps
```

Containers band karne ke liye (jab kaam ho jaye):

```bash
docker compose down
```

### 3. Node server start karo

```bash
npm run dev
```

Isse `nodemon` ke through server start hota hai, jo `http://localhost:8000`
par sunna shuru kar deta hai. `nodemon` file me kuch bhi change hone par
server ko khud restart kar deta hai (development ke liye kaam aata hai).

## Available API Routes

> Code me (`index.js` aur `site-banner.js`) har route ke upar ek standard
> JSDoc-style comment hai, is format me:
> ```js
> // @route   GET /banner
> // @desc    Current banner fetch karo
> // @access  Public
> ```
> Isse code khud padhte waqt hi pata chal jata hai ki wo route kaunsa method
> + path handle karta hai aur uska kaam kya hai — bina neeche implementation
> padhe.

| Method | Route            | Kaam kya karta hai |
|--------|------------------|---------------------|
| GET    | `/redis`         | Redis ko `PING` karta hai, connection check karne ke liye. Reply me `PONG` aana chahiye. |
| GET    | `/mongo`         | MongoDB se connect karta hai (agar pehle se connected nahi hai), aur connected database ka naam return karta hai. |
| GET    | `/banner`        | Redis me `site:banner` key ke andar stored banner data return karta hai. Agar set nahi hai, `404` return hota hai. |
| POST   | `/banner`        | Naya banner set/update karta hai. Body me `{ "message": "...", "color": "..." }` chahiye. |
| DELETE | `/banner`        | Banner ko Redis se delete kar deta hai. |
| GET    | `/banner/exists` | Sirf ye batata hai ki banner set hai ya nahi (`{ "exists": true/false }`), actual data fetch kiye bina. |
| POST   | `/otp`           | Diye gaye phone number ke liye naya OTP generate karta hai aur Redis me `60 second` ki expiry ke saath store karta hai. Body: `{ "phone": "..." }`. Agar us phone ke liye pehle se OTP active hai, `429` (cooldown) return hota hai. |
| POST   | `/otp/verify`    | User ka diya hua OTP, Redis me stored value se match karke verify karta hai. Sahi hone par OTP turant delete ho jata hai (ek baar hi use ho sakta hai). Galat hone par attempts count hota hai; `5` galat attempts ke baad OTP invalidate ho jata hai (`429`). Body: `{ "phone": "...", "otp": "..." }`. |
| GET    | `/otp/:phone/ttl`| Diye gaye phone number ke current OTP ka TTL (baaki bacha hua time, seconds me) batata hai. |

### Banner test karne ke liye (example commands)

```bash
# Banner set karo
curl -X POST http://localhost:8000/banner \
  -H "Content-Type: application/json" \
  -d '{"message":"Sale live!","color":"red"}'

# Banner check karo
curl http://localhost:8000/banner

# Banner exist karta hai ya nahi, check karo
curl http://localhost:8000/banner/exists

# Banner delete karo
curl -X DELETE http://localhost:8000/banner
```

### OTP test karne ke liye (example commands)

```bash
# OTP generate/send karo (server console me OTP print hoga, demo ke liye)
curl -X POST http://localhost:8000/otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210"}'

# OTP verify karo (console me print hui value yahan daalo)
curl -X POST http://localhost:8000/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","otp":"123456"}'

# OTP ka baaki bacha hua time (seconds) check karo
curl http://localhost:8000/otp/9876543210/ttl
```

> Note: Abhi real SMS gateway (Twilio/MSG91 jaisa) integrate nahi kiya hai —
> OTP sirf server ke console log me print hota hai, taaki learning/testing
> aasan rahe.

## OTP Verification System — Deep Dive

Ye section poori tarah samjhata hai ki `setup/otp.js` ke andar OTP system
kaise kaam karta hai, taaki iski internal working clear rahe — sirf
routes ka table hi nahi.

### High-level flow

```
Client                     Server (otp.js)                    Redis
  |                              |                               |
  |--- POST /otp {phone} ------->|                               |
  |                              |-- normalizePhone(phone) ----->|
  |                              |-- generateOtp() -------------->|
  |                              |-- SET otp:<phone> otp EX 60 NX-|
  |                              |                    (atomic)    |
  |                              |<--- OK / null (cooldown) ------|
  |<---- success / 429 ----------|                               |
  |                              |                               |
  |--- POST /otp/verify -------->|                               |
  |    {phone, otp}              |-- GET otp:<phone> ------------>|
  |                              |<--- storedOtp / null ----------|
  |                    match? -- yes -> DEL otp key + attempts key
  |                              |     no  -> INCR attempts key,
  |                              |            5th galat par DEL
  |<---- success / 400 / 429 ----|                               |
  |                              |                               |
  |--- GET /otp/:phone/ttl ----->|                               |
  |                              |-- TTL otp:<phone> ------------>|
  |<---- { phone, ttl } ---------|<--- seconds remaining ---------|
```

### Redis me kya-kya store hota hai

| Redis Key                 | Value        | Expiry (TTL)         | Kaam |
|----------------------------|--------------|----------------------|------|
| `otp:<phone>`               | 6-digit OTP  | `60` seconds         | Actual OTP value, jo verify ke waqt match hoti hai. |
| `otp:attempts:<phone>`      | Number (count)| `60` seconds (OTP jaisi hi) | Kitni baar galat OTP diya gaya, uska counter. |

`<phone>` hamesha normalized 10-digit form me hota hai (neeche dekho), chahe
user ne kisi bhi format me number diya ho.

### 1. Resend Cooldown (`SET ... EX 60 NX`)

```js
const result = await redis.set(key, otp, 'EX', OTP_EXPIRY_SECONDS, 'NX');
```

- `EX 60` -> is key ko 60 second baad apne aap expire (delete) kar do.
- `NX` (**N**ot e**X**ists) -> value **sirf tabhi set karo jab key pehle se
  exist na karti ho**.
- Agar phone ka OTP already active hai (abhi expire nahi hua), Redis
  `null` return karta hai — matlab kuch set nahi hua. Server isko dekh ke
  `429 Too Many Requests` bhejta hai, saath me `retryAfterSeconds` (kitni
  der baad phir try kare).
- **Kyu zaroori hai:** Bina cooldown ke koi bhi `/otp` endpoint ko loop me
  call karke unlimited SMS trigger karwa sakta hai (cost abuse / spam).
- **Kyu atomic hona zaroori hai:** Agar hum pehle `GET` karke check karte
  "OTP hai ya nahi", fir alag se `SET` karte, to do requests **same
  milisecond** par aayein to dono ko lag sakta hai "OTP nahi hai" aur dono
  apna-apna OTP set kar dein (race condition). `SET ... NX` ye poora kaam
  Redis ke andar ek hi atomic step me karta hai, isliye race condition
  possible hi nahi hai.

### 2. Max Verify Attempts (Brute-force protection)

```js
const attempts = await redis.incr(attemptsKey);
if (attempts === 1) await redis.expire(attemptsKey, OTP_EXPIRY_SECONDS);
if (attempts >= MAX_VERIFY_ATTEMPTS) { /* OTP invalidate kar do */ }
```

- Har galat OTP submit hone par `otp:attempts:<phone>` counter `+1` hota
  hai (`redis.incr()` — agar key exist nahi karti to Redis use 0 maan ke
  seedha 1 bana deta hai).
- Counter ki expiry OTP jitni hi rakhi hai, taaki OTP expire hote hi
  attempts count bhi apne aap saaf ho jaye — alag se cleanup nahi karna
  padta.
- `5` galat attempts ke baad OTP **aur** attempts dono keys delete kar dete
  hain, aur `429` return karte hain — user ko ab naya OTP mangwana padega.
- **Kyu zaroori hai:** 6-digit OTP ke sirf `1,000,000` possible combinations
  hote hain. Bina limit ke, koi bhi script kuch second me saare
  combinations try karke OTP guess kar sakti hai. Attempts limit isko
  practically impossible bana deti hai.

### 3. Phone Normalization

```js
function normalizePhone(phone) {
    const digitsOnly = String(phone).replace(/\D/g, '');
    if (digitsOnly.length < 10) return null;
    return digitsOnly.slice(-10);
}
```

- Saare non-digit characters (`+`, space, `-`, brackets) hata dete hain.
- Sirf **aakhri 10 digits** rakhte hain — isse country code (`91`, `+91`)
  apne aap chhoot jata hai.
- 10 digits se kam bachne par `null` return hota hai -> route isko invalid
  phone maan ke `400` de deta hai.
- **Kyu zaroori hai:** Agar normalization na ho, to `"+919876543210"` aur
  `"9876543210"` do **alag** Redis keys (`otp:+919876543210` vs
  `otp:9876543210`) ban jaayengi. User ne OTP request karte waqt ek format
  diya aur verify karte waqt doosra — to OTP kabhi match hi nahi hoga,
  bawajood iske ki value sahi thi.

### Example responses

```jsonc
// POST /otp -> pehli baar, success
{ "success": true, "message": "OTP sent successfully. It will expire in 60 seconds." }

// POST /otp -> turant dobara call kiya (cooldown active)
{ "error": "An OTP was already sent recently. Please wait before requesting a new one.", "retryAfterSeconds": 47 }

// POST /otp/verify -> galat OTP (abhi attempts bache hain)
{ "error": "Invalid OTP", "attemptsRemaining": 3 }

// POST /otp/verify -> 5 galat attempts ho chuke
{ "error": "Too many incorrect attempts. Please request a new OTP." }

// GET /otp/:phone/ttl -> koi OTP active nahi hai
{ "error": "No active OTP found for this phone number" }
```

### Isse aage kya aur improve kiya ja sakta hai (production ke liye)

Ye learning project hai, isliye kuch cheezein jaan-boojh kar simple
rakhi gayi hain. Ek real production system me ye bhi karna chahiye:

- OTP ko Redis me plain text ke bajaye **hash** karke store karna (jaise
  password store karte hain), taaki Redis compromise hone par bhi raw OTP
  na dikhe.
- Console `console.log` ke bajaye actual SMS gateway (Twilio/MSG91) se OTP
  bhejna, aur production me OTP ki value kabhi bhi logs me print na karna.
- Per-IP rate limiting (jaise `express-rate-limit`), sirf per-phone
  cooldown ke alawa — taaki ek IP se hazaron alag phone numbers par bhi
  spam na ho sake.

## Environment Variables (optional)

Agar chaho to default local URLs override kar sakte ho:

| Variable      | Default (agar set na ho)                          | Kaam |
|---------------|-----------------------------------------------------|------|
| `PORT`        | `8000`                                               | Express server kis port par chalega |
| `REDIS_URL`   | `redis://localhost:6379`                             | Redis connection URL |
| `MONGO_URL`   | `mongodb://localhost:27017/chai_aur_redis`          | MongoDB connection URL |

## Notes / Gotchas

- Agar `docker compose up` "cannot connect to docker daemon" jaisi error de,
  to Docker Desktop chal hi nahi raha — pehle usse open/start karo.
- Redis me data persist rehta hai kyunki `--appendonly yes` flag ke saath
  AOF persistence enable hai, aur data ek named volume (`redis-data`) me
  save hota hai. Isi tarah MongoDB ka data `mongo-data` volume me persist
  hota hai. Matlab container restart/remove karne par bhi data khota nahi
  (jab tak volume delete na karo).

---

## Maine (learning journey) kya kya steps follow kiye — Log

Ye section un actual steps/mistakes ka record hai jo is project ko banate
waqt follow/fix kiye gaye, taaki baad me revise karte waqt yaad rahe.

1. **Docker Compose file banayi** — `redis` aur `mongo` do services define
   ki, dono ke fixed `container_name`, `ports`, aur data persist karne ke
   liye named `volumes` (`redis-data`, `mongo-data`) add kiye.

2. **`docker compose up` chalane par error aayi** — turns out Docker Desktop
   app hi running nahi tha (`unix:///.../docker.sock` connect nahi ho pa
   raha tha). Fix: Docker Desktop ko `open -a Docker` se start kiya.

3. **Docker Desktop me containers ko group karke naam dena tha** — top-level
   `name:` key (`docker-compose.yml` me) add ki, taaki Docker Desktop me
   saare containers ek naamed group ke andar dikhein, individual folder-name
   ke bajaye.

4. **`npm run dev` chalane par app crash ho rahi thi** — do galtiyan mili:
   - `Process.env.REDIS_URL` likha tha (capital `P`), jबकि Node ka global
     object hamesha lowercase `process` hota hai — isse
     `ReferenceError: Process is not defined` aa raha tha.
   - `package.json` ka `dev` script root se `index.js` dhoond raha tha,
     jबकि actual file `setup/index.js` me thi. Script ko
     `"nodemon setup/index.js"` kiya.

5. **`/mongo` route par error aa rahi thi** — `mongoose.connect()` ko
   `useNewUrlParser` aur `useUnifiedTopology` options di gayi thi, jo
   Mongoose ke naye version (v9) me support hi nahi karte (deprecated ho
   chuke hain, ab default behavior hi wahi hai). Fix: dono options hata di.

6. **Banner feature add ki** — pehle sab kuch `index.js` me hi likha tha,
   jisme ek bug bhi tha: `const BANNER_KEY = BANNER_KEY;` (khud ko hi
   reference kar raha tha, isse crash hota).

7. **Banner ka code alag file me move kiya (`setup/site-banner.js`)** —
   Express ka **Router** pattern use karke: ek factory function
   (`siteBannerRouter(redis)`) banayi jo Redis client accept karti hai aur
   ek configured `Router` return karti hai. Isse:
   - `index.js` chhota/clean rehta hai.
   - Redis ka ek hi shared connection reuse hota hai (naya connection nahi
     banta har route file me).
   - `BANNER_KEY` bug bhi fix ho gaya — ab ek proper string
     (`'site:banner'`) hai.

8. **Banner ke aur routes add kiye** — sirf `GET /banner` tha, usme add
   kiya:
   - `POST /banner` — naya banner set/update karne ke liye (validation ke
     saath: `message` aur `color` dono required hain).
   - `DELETE /banner` — banner hatane ke liye.
   - `GET /banner/exists` — sirf existence check karne ke liye (halka/fast
     check, bina data fetch/parse kiye).

9. **Poori codebase me detailed comments (Hinglish me) add kiye** —
   `docker-compose.yml`, `index.js`, aur `site-banner.js` — taaki har line
   /section ka use-case aur "kyu likha gaya" clear rahe, kyunki Docker aur
   Redis dono naye topics hain.

10. **Har route ke upar standard `@route` / `@desc` / `@access` comments
    add kiye** (`index.js` aur `site-banner.js` dono me) — ek common Express
    convention, jisse har route ka method + path aur kaam ek nazar me pata
    chal jaye. `app.use(siteBannerRouter(redis))` ke upar bhi comment me
    likha ki is function se konse-konse route paths mount ho rahe hain
    (`GET /banner`, `POST /banner`, `DELETE /banner`, `GET /banner/exists`).

11. **OTP verification feature add ki (`setup/otp.js`)** — Banner jaisa hi
    Express Router pattern use karke, 3 naye routes banaye:
    - `POST /otp` — phone number ke liye ek random 6-digit OTP generate
      karta hai aur Redis me `SET key value EX 60` se **60 second ki
      expiry** ke saath store karta hai (Redis khud hi expire hote hi
      delete kar deta hai, manual cleanup ki zaroorat nahi).
    - `POST /otp/verify` — Redis se stored OTP nikaal ke user ke diye hue
      OTP se match karta hai. Match hone par OTP ko turant `redis.del()`
      se delete kar dete hain, taaki wahi OTP dobara (replay attack ki
      tarah) reuse na ho sake — ek OTP sirf ek hi baar valid hota hai.
    - `GET /otp/:phone/ttl` — `redis.ttl()` command se batata hai ki us
      phone ke OTP ka abhi kitna time bacha hai (seconds me); agar OTP
      exist hi nahi karta (kabhi bheja hi nahi gaya, ya expire ho chuka),
      to `404` return hota hai.
    - Poori file (`otp.js`) aur `index.js` me mounting wale hisse me
      detailed Hinglish comments add kiye — same standard jo banner file
      me use kiya tha (`@route` / `@desc` / `@body` / `@access`).

12. **OTP system me production-grade safeguards add kiye (`setup/otp.js`)**
    — as a backend developer jaanna zaroori hai ki basic "generate + store
    + match" flow production ke liye kaafi nahi hota:
    - **Resend cooldown** — `redis.set(key, otp, 'EX', 60, 'NX')` use kiya.
      `NX` flag ka matlab hai "sirf tab set karo jab key exist na kare" —
      isse agar phone ka OTP already active hai to naya request `429`
      status ke saath reject ho jata hai, aur ye check + set ek hi atomic
      Redis operation me hota hai (isliye do parallel requests aane par
      race condition nahi hogi).
    - **Max verify attempts** — Har phone ke galat verify attempts `otp:
      attempts:<phone>` key me `redis.incr()` se count kiye jate hain (usi
      OTP jitni expiry ke saath). `5` galat attempts ke baad OTP aur
      attempts dono key delete kar dete hain — attacker ko unlimited
      guesses nahi milte (brute-force protection).
    - **Phone normalization** — `normalizePhone()` function saare
      non-digit characters (`+`, spaces, `-`) hata ke sirf aakhri 10 digits
      rakhta hai. Isse `+91 98765-43210` aur `9876543210` dono same Redis
      key (`otp:9876543210`) use karte hain — warna formatting farak ki
      wajah se OTP kabhi match hi nahi hota.
    - In teeno ke against manual testing ki: resend turant dobara call
      karne par cooldown message aaya, 5 galat OTP submit karne par lockout
      hua, aur `+91` prefix wale number se bheja OTP plain 10-digit number
      se hi verify ho gaya.
# redis-with-nodejs

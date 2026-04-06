<template>
  <div class="login-page">
    <!-- Top Nav -->
    <nav class="top-nav">
      <router-link to="/" style="text-decoration: none;">
        <BrandLogo size="1.5rem" gap="0.5rem" textSize="1.5rem" />
      </router-link>
    </nav>

    <div class="split-layout">
      <!-- Left: Book Illustration -->
      <div class="illustration-side">
        <div class="desk">
          <!-- Book -->
          <div class="book" @mousemove="onBookHover" @mouseleave="onBookLeave">
            <div class="spine"></div>
            <div class="pg pg-l">
              <div class="ln"></div><div class="ln"></div><div class="ln s"></div>
              <div class="ln"></div><div class="ln s"></div>
              <div class="ln"></div><div class="ln s"></div><div class="ln"></div>
              <div class="ring"></div>
            </div>
            <div class="pg pg-r">
              <div class="pg-title">Chapter 1</div>
              <div class="pg-sub">A New Beginning</div>
              <div class="tl"></div><div class="tl"></div><div class="tl s"></div>
              <div class="tl"></div><div class="tl s"></div><div class="tl"></div>
              <div class="hw"><span>{{ typedText }}<span class="caret">|</span></span></div>
            </div>
          </div>

          <!-- Pencil -->
          <div class="pencil" :class="{ writing: pencilActive }"
               @mouseenter="pencilActive = true" @mouseleave="pencilActive = false">
            <div class="p-body"></div>
            <div class="p-tip"></div>
            <div class="p-eraser"></div>
          </div>

          <!-- Coffee -->
          <div class="mug" :class="{ steaming: mugActive }"
               @mouseenter="mugActive = true" @mouseleave="mugActive = false">
            <div class="mug-body"></div>
            <div class="mug-handle"></div>
            <div class="vap v1"></div><div class="vap v2"></div><div class="vap v3"></div>
            <div class="vap v4"></div><div class="vap v5"></div>
          </div>

          <!-- Bookmark -->
          <div class="ribbon"></div>
        </div>
      </div>

      <!-- Right: Login Form -->
      <div class="form-side">
        <h1><span>Welcome</span><span class="it">Back.</span></h1>
        <p class="lead">Sign in to continue your learning journey with Frank.dev.</p>

        <form class="login-form" @submit.prevent="handleLogin">
          <div class="field">
            <label for="email">Email Address</label>
            <input v-model="loginForm.username" id="email" placeholder="you@example.com" type="text" />
          </div>
          <div class="field">
            <div class="pw-row">
              <label for="password">Password</label>
              <router-link to="/forgot-password" class="forgot">Forgot?</router-link>
            </div>
            <input v-model="loginForm.password" id="password" placeholder="••••••••" type="password" @keyup.enter="handleLogin" />
          </div>
          <button type="submit" :disabled="loading" class="btn-primary">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? "Signing in..." : "Sign In" }}
          </button>
        </form>

        <div class="divider"><span>or</span></div>

        <div class="social-row">
          <button class="btn-social" type="button">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M214.1 512c0-32.5 5.5-63.7 15.4-92.9L57.2 290.2A492 492 0 0 0 4.7 512c0 79.7 18.9 154.9 52.4 221.6l172.2-129A291 291 0 0 1 214.1 512" fill="#FBBC05"/>
              <path d="M516.7 216.2c72.1 0 137.3 25 188.5 66L854.1 136.5C763.3 59.2 647 11.4 516.7 11.4c-202.3 0-376.2 113.3-459.5 278.8l172.4 128.9c39.7-118 152.8-202.9 287.1-202.9" fill="#EA4335"/>
              <path d="M516.7 807.8c-134.4 0-247.5-84.9-287.2-202.9l-172.3 128.9c83.2 165.5 257.2 278.8 459.5 278.8 124.8 0 244.1-43.4 333.6-124.8L686.9 764.2c-46.1 28.5-104.2 43.8-170 43.8" fill="#34A853"/>
              <path d="M1005.4 512c0-29.6-4.7-61.4-11.6-91H516.7V614.4h274.6c-13.7 66-51.1 116.7-104.5 149.6l163.5 123.8c94-85.4 155.1-212.7 155.1-375.8" fill="#4285F4"/>
            </svg>
            Google
          </button>
          <button class="btn-social" type="button">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.3-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9 23.5 23.2 38.1 55.4 38.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z" fill="currentColor"/>
            </svg>
            GitHub
          </button>
        </div>

        <p class="register" v-if="register">
          New here? <router-link to="/register" class="reg-link">Create an account</router-link>
        </p>
      </div>
    </div>

    <SimpleFooter year="2026" company="Frank.dev" />
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import useUserStore from "@/store/auth/user";
import BrandLogo from "@/components/BrandLogo.vue";
import SimpleFooter from "@/components/SimpleFooter.vue";

const userStore = useUserStore();
const route = useRoute();
const router = useRouter();

/* --- Interactive states --- */
const pencilActive = ref(false);
const mugActive = ref(false);
const typedText = ref('');
const msg = 'Welcome back!';
let timer = null;

function startTyping() {
  let i = 0;
  typedText.value = '';
  (function tick() {
    if (i < msg.length) {
      typedText.value += msg[i++];
      timer = setTimeout(tick, 80 + Math.random() * 60);
    } else {
      timer = setTimeout(() => { i = 0; typedText.value = ''; tick(); }, 3000);
    }
  })();
}

function onBookHover(e) {
  const el = e.currentTarget, r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  el.style.transform = `translateX(-50%) perspective(800px) rotateY(${x*8}deg) rotateX(${-y*5}deg)`;
}
function onBookLeave(e) { e.currentTarget.style.transform = 'translateX(-50%)'; }

onMounted(startTyping);
onUnmounted(() => { if (timer) clearTimeout(timer); });

/* --- Auth --- */
const loginForm = ref({ username: "admin", password: "admin" });
const loading = ref(false);
const register = ref(true);
const redirect = ref(undefined);

watch(route, (r) => { redirect.value = r.query?.redirect; }, { immediate: true });

function handleLogin() {
  if (!loginForm.value.username) { ElMessage.error("Please input your account number."); return; }
  if (!loginForm.value.password) { ElMessage.error("Please input your password"); return; }
  loading.value = true;
  userStore.login(loginForm.value)
    .then(() => {
      const q = route.query;
      const rest = Object.keys(q).reduce((a, k) => { if (k !== "redirect") a[k] = q[k]; return a; }, {});
      router.push({ path: redirect.value || "/", query: rest });
    })
    .catch(() => { loading.value = false; });
}
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=VT323&display=swap");

/* ── Variables ── */
.login-page {
  --b-light: #F0EDE0; --b-main: #E0DCCF; --b-dark: #C4C0B3; --b-shadow: #A09C8F;
  --ink: #0f0f0f; --blue: #2B6CB0; --orange: #C05621;
  --paper: #FAF8F2; --cream: #F5F0E3;
  --p-yellow: #E8B84B; --p-pink: #E07B7B; --coffee: #6B4226;
  --serif: 'EB Garamond', serif; --mono: 'VT323', monospace;

  font-family: var(--serif);
  background: #f4f1e6;
  color: var(--ink);
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Top Nav ── */
.top-nav {
  width: 100%; max-width: 1400px; margin: 0 auto;
  padding: 1.25rem 4rem; flex-shrink: 0;
}

/* ── Two-column layout ── */
.split-layout {
  flex: 1; display: grid;
  grid-template-columns: 1.1fr 1fr;
  align-items: center;
  max-width: 1400px; width: 100%; margin: 0 auto;
  padding: 0 4rem 2rem;
  min-height: 0;
}

/* ══════════════════════════════════════
   LEFT — Desk Illustration
   ══════════════════════════════════════ */
.illustration-side {
  display: flex; justify-content: center; align-items: center;
  overflow: hidden; position: relative;
}

.desk {
  position: relative;
  width: 460px; height: 400px;
  flex-shrink: 0;
  animation: fade-up .8s ease-out;
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(30px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Book */
.book {
  position: absolute;
  top: 50px; left: 50%;
  transform: translateX(-50%);
  width: 340px; height: 250px;
  display: flex; perspective: 800px;
  transition: transform .15s ease-out;
  cursor: default;
}

.spine {
  position: absolute; left: 50%; transform: translateX(-50%);
  width: 12px; height: 100%; z-index: 2;
  background: linear-gradient(90deg, #8B6F47, #A0845C, #8B6F47);
  border-radius: 2px;
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}

.pg {
  width: 50%; height: 100%; position: relative;
  border-radius: 4px; padding: 22px 18px;
  box-shadow: 0 4px 20px rgba(0,0,0,.1);
  transition: transform .4s ease;
}
.pg-l {
  background: var(--cream);
  border-radius: 4px 0 0 4px;
  transform: rotateY(2deg); transform-origin: right center;
}
.pg-l:hover { transform: rotateY(6deg); }
.pg-r {
  background: var(--paper);
  border-radius: 0 4px 4px 0;
  transform: rotateY(-2deg); transform-origin: left center;
  box-shadow: 6px 4px 20px rgba(0,0,0,.1);
}
.pg-r:hover { transform: rotateY(-6deg); }

/* Page lines */
.ln  { width: 88%; height: 2px; background: rgba(160,156,143,.25); margin-bottom: 14px; }
.ln.s { width: 55%; }

/* Coffee ring on page */
.ring {
  position: absolute; bottom: 28px; left: 28px;
  width: 48px; height: 48px; border-radius: 50%;
  border: 3px solid rgba(139,90,43,.12);
  background: radial-gradient(circle, rgba(139,90,43,.04) 40%, transparent 70%);
  animation: ring-breathe 3s ease-in-out infinite;
}
@keyframes ring-breathe { 0%,100%{ opacity:.7 } 50%{ opacity:1 } }

/* Right page content */
.pg-title { font-family: var(--serif); font-size: 1.35rem; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
.pg-sub   { font-family: var(--serif); font-style: italic; font-size: .9rem; color: var(--b-shadow); margin-bottom: 14px; }

.tl  { width: 92%; height: 2px; background: rgba(160,156,143,.2); margin-bottom: 11px; }
.tl.s { width: 62%; margin-bottom: 18px; }

.hw {
  font-family: var(--serif); font-style: italic;
  font-size: 2rem; font-weight: 600;
  color: var(--blue); line-height: 1.1;
  margin-top: 6px; transform: rotate(-3deg);
  text-shadow: 1px 1px 0 rgba(43,108,176,.1);
  min-height: 2.6rem;
}
.caret { animation: blink .8s step-end infinite; font-weight: 300; }
@keyframes blink { 0%,100%{ opacity:1 } 50%{ opacity:0 } }

/* Pencil */
.pencil {
  position: absolute; bottom: 28px; right: 36px;
  transform: rotate(-25deg); z-index: 5;
  transition: transform .3s ease; cursor: pointer;
}
.pencil:hover { transform: rotate(-30deg) translateY(-4px); }
.pencil.writing { animation: write .15s ease-in-out infinite alternate; }
@keyframes write {
  0%  { transform: rotate(-25deg) translateX(0); }
  100%{ transform: rotate(-23deg) translateX(3px); }
}

.p-body {
  width: 120px; height: 10px;
  background: var(--p-yellow);
  border-radius: 0 2px 2px 0; position: relative;
  box-shadow: 0 2px 4px rgba(0,0,0,.15);
}
.p-body::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background:rgba(255,255,255,.2); border-radius:0 2px 0 0; }
.p-body::after  { content:''; position:absolute; top:50%; left:10px; right:10px; height:1px; background:rgba(0,0,0,.1); }

.p-tip {
  position: absolute; top: 0; right: 118px;
  width: 0; height: 0;
  border-top: 5px solid transparent; border-bottom: 5px solid transparent;
  border-right: 14px solid #D4A04A;
}
.p-tip::after {
  content:''; position: absolute; top: -3px; left: 12px;
  width: 0; height: 0;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-right: 6px solid #333;
}
.p-eraser {
  position: absolute; top: 0; left: 120px;
  width: 20px; height: 10px;
  background: var(--p-pink);
  border-radius: 0 3px 3px 0;
  box-shadow: 0 2px 4px rgba(0,0,0,.1);
}
.p-eraser::before { content:''; position:absolute; left:-3px; top:0; width:3px; height:10px; background:#C0C0C0; }

/* Coffee Mug */
.mug {
  position: absolute; top: 8px; right: 44px;
  z-index: 5; cursor: pointer;
  transition: transform .3s ease;
}
.mug:hover { transform: translateY(-3px); }

.mug-body {
  width: 50px; height: 40px;
  background: var(--paper); border: 2px solid var(--b-shadow);
  border-radius: 0 0 8px 8px; position: relative;
  box-shadow: 2px 3px 8px rgba(0,0,0,.1);
}
.mug-body::before {
  content:''; position: absolute; top:4px; left:4px; right:4px; height:6px;
  background: var(--coffee); border-radius: 0 0 4px 4px; opacity:.7;
}
.mug-handle {
  position: absolute; top:8px; left:48px;
  width:14px; height:18px;
  border: 2px solid var(--b-shadow); border-left:none;
  border-radius: 0 10px 10px 0;
}

.vap {
  position: absolute; width: 2px; height: 16px;
  background: rgba(160,156,143,.3); border-radius: 2px;
  animation: vap-rise 2.5s ease-in-out infinite;
}
.v1 { left:14px; top:-20px; animation-delay:0s; }
.v2 { left:24px; top:-18px; animation-delay:.8s; }
.v3 { left:34px; top:-22px; animation-delay:1.6s; }
.v4, .v5 { display: none; }
.v4 { left:19px; top:-24px; }
.v5 { left:29px; top:-16px; }

@keyframes vap-rise {
  0%  { opacity:0; transform: translateY(0) scaleX(1); }
  30% { opacity:.6; }
  70% { opacity:.3; transform: translateY(-12px) scaleX(1.5); }
  100%{ opacity:0; transform: translateY(-20px) scaleX(2); }
}

/* Hover steam burst */
.mug.steaming .vap { animation-duration: 1s !important; }
.mug.steaming .v4, .mug.steaming .v5 { display: block; animation-delay: .3s, 1.1s; }

/* Bookmark ribbon */
.ribbon {
  position: absolute; top: 18px; left: calc(50% + 40px);
  width: 16px; height: 60px;
  background: var(--orange);
  border-radius: 0 0 4px 4px;
  z-index: 4;
  box-shadow: 1px 2px 4px rgba(0,0,0,.15);
  animation: sway 4s ease-in-out infinite;
}
.ribbon::after {
  content:''; position: absolute; bottom:0; left:0;
  width:0; height:0;
  border-left: 8px solid var(--orange);
  border-right: 8px solid var(--orange);
  border-bottom: 10px solid transparent;
}
@keyframes sway { 0%,100%{ transform:rotate(3deg) } 50%{ transform:rotate(-1deg) } }

/* ══════════════════════════════════════
   RIGHT — Login Form
   ══════════════════════════════════════ */
.form-side {
  padding-left: 2rem; padding-right: 4rem;
  z-index: 10; max-width: 480px;
}

h1 {
  font-size: 4.5rem; line-height: .85; margin: 0 0 1.5rem 0;
  letter-spacing: -2px; font-weight: 500;
}
h1 span { display: block; }
.it { font-style: italic; white-space: nowrap; margin-left: -4px; }

.lead {
  font-size: 1.35rem; line-height: 1.25;
  margin-bottom: 2rem; color: #555;
}

/* Fields */
.login-form { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }

.field label {
  display: block; font-size: .8rem; font-weight: 600;
  text-transform: uppercase; letter-spacing: 1px;
  margin-bottom: .4rem; color: var(--b-shadow);
}

.pw-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: .4rem; }
.pw-row label { margin-bottom: 0; }

.forgot { font-size: .85rem; color: var(--blue); }
.forgot:hover { text-decoration: underline; }

input[type="text"],
input[type="password"] {
  width: 100%; padding: .85rem 1rem;
  background: var(--b-light); border: 1px solid var(--b-shadow);
  border-radius: 8px; color: var(--ink);
  font-family: var(--serif); font-size: 1rem;
  box-shadow: inset 1px 1px 3px rgba(0,0,0,.08);
  transition: border-color .2s, box-shadow .2s; outline: none;
}
input::placeholder { color: var(--b-shadow); }
input:focus {
  border-color: var(--blue);
  box-shadow: inset 1px 1px 3px rgba(0,0,0,.08), 0 0 0 3px rgba(43,108,176,.15);
}

/* Primary button */
.btn-primary {
  width: 100%; padding: 1rem 2rem;
  background: var(--ink); color: #f4f1e6;
  font-size: 1.2rem; font-family: var(--serif);
  border: 2px solid var(--ink); border-radius: 8px;
  cursor: pointer; transition: all .2s ease;
  display: flex; align-items: center; justify-content: center; gap: .5rem;
}
.btn-primary:hover { background: transparent; color: var(--ink); }
.btn-primary:disabled { opacity: .6; cursor: not-allowed; }

.spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid #f4f1e6; border-top-color: transparent;
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Divider */
.divider {
  display: flex; align-items: center; gap: 1rem; margin: 1.5rem 0;
}
.divider::before, .divider::after {
  content: ''; flex: 1; height: 1px; background: var(--b-shadow);
}
.divider span { color: var(--b-shadow); font-size: .85rem; font-style: italic; }

/* Social */
.social-row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.btn-social {
  display: flex; align-items: center; justify-content: center; gap: .5rem;
  padding: .7rem 1rem; background: var(--b-light);
  border: 1px solid var(--b-shadow); border-radius: 8px;
  font-family: var(--serif); font-size: .95rem; font-weight: 600;
  color: var(--ink); cursor: pointer; transition: background .2s;
}
.btn-social:hover { background: var(--b-main); }
.btn-social svg { width: 1.2rem; height: 1.2rem; flex-shrink: 0; }

/* Register */
.register { margin-top: 1.5rem; color: #555; font-size: .95rem; }
.reg-link { color: var(--blue); font-weight: 600; }
.reg-link:hover { text-decoration: underline; }

/* ── Responsive ── */
@media (max-width: 1000px) {
  .split-layout {
    grid-template-columns: 1fr;
    padding: 0 2rem 2rem;
  }
  .illustration-side { display: none; }
  .form-side {
    padding: 2rem 0; max-width: 100%; text-align: center;
  }
  h1 { font-size: 3.2rem; }
  .lead { font-size: 1.15rem; }
}
</style>

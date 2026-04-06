<template>
  <div class="animated-loader">
    <!-- Background decorative elements -->
    <div class="bg-pattern" aria-hidden="true"></div>
    <div class="paper-texture" aria-hidden="true"></div>

    <!-- Main content -->
    <main class="loader-main">
      <!-- Duck logo + typewriter animation -->
      <div class="logo-area">
        <BrandLogo size="4rem" gap="1rem" textSize="3rem" textColor="#0f0f0f" />
        <div class="typewriter-line">
          <span class="typed-text">{{ displayedText }}<span class="caret">|</span></span>
        </div>
      </div>

      <!-- Decorative divider -->
      <div class="divider" aria-hidden="true">
        <span class="divider-ornament">&#10087;</span>
      </div>

      <!-- Fact card (book page style) -->
      <div class="fact-card">
        <div class="fact-header">
          <span class="fact-icon">&#9782;</span>
          <span class="fact-label">Marginalia</span>
        </div>
        <p class="fact-text" :key="currentFactIndex">
          {{ currentFact }}
        </p>
        <div class="fact-progress-track">
          <div class="fact-progress-fill" :style="{ width: factProgress + '%' }"></div>
        </div>
      </div>

      <p class="loading-text">
        <span class="loading-dots">
          <span>.</span><span>.</span><span>.</span>
        </span>
        Loading resources
      </p>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import BrandLogo from '@/components/BrandLogo.vue';

const facts = [
  'The first computer bug was an actual moth found in a Harvard Mark II computer in 1947.',
  'JavaScript was created in just 10 days by Brendan Eich in 1995.',
  'CSS was first proposed by Håkon Wium Lie on October 10, 1994.',
  'The QWERTY keyboard was designed to slow down typists to prevent typewriter jams.',
  'The first website is still online! It was created by Tim Berners-Lee at CERN.',
  'Python is named after the British comedy group Monty Python, not the snake.',
  'About 700 new programming languages are created every year.',
  'The space between lines of text is called "leading" from old printing press strips of lead.',
  'Design relies on the "Golden Ratio" (1.618) to create aesthetically pleasing compositions.',
  'White space in design is not empty space; it\'s an active design element.',
];

const FACT_DURATION = 5000;

const currentFactIndex = ref(0);
const factProgress = ref(0);
const displayedText = ref('');
const typingFullText = 'Preparing your workspace...';

let factInterval = null;
let progressInterval = null;
let typingIndex = 0;
let typingInterval = null;

const currentFact = computed(() => facts[currentFactIndex.value]);

function startProgress() {
  factProgress.value = 0;
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    factProgress.value = Math.min(100, factProgress.value + (100 / (FACT_DURATION / 50)));
  }, 50);
}

function nextFact() {
  currentFactIndex.value = (currentFactIndex.value + 1) % facts.length;
  startProgress();
}

function startTyping() {
  typingInterval = setInterval(() => {
    if (typingIndex < typingFullText.length) {
      displayedText.value = typingFullText.slice(0, typingIndex + 1);
      typingIndex++;
    } else {
      clearInterval(typingInterval);
    }
  }, 60);
}

onMounted(() => {
  startProgress();
  startTyping();
  factInterval = setInterval(nextFact, FACT_DURATION);
});

onUnmounted(() => {
  clearInterval(factInterval);
  clearInterval(progressInterval);
  clearInterval(typingInterval);
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=VT323&display=swap');

/* ---- Variables ---- */
.animated-loader {
  --beige-light: #F0EDE0;
  --beige-main: #E0DCCF;
  --beige-dark: #C4C0B3;
  --beige-shadow: #A09C8F;
  --ink-black: #0f0f0f;
  --accent-orange: #C05621;
  --accent-blue: #2B6CB0;
  --bg: #f4f1e6;
  --surface: #FAF8F1;
  --font-serif: 'EB Garamond', serif;
  --font-mono: 'VT323', monospace;
}

/* ---- Layout ---- */
.animated-loader {
  min-height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  color: var(--ink-black);
  font-family: var(--font-serif);
  position: relative;
  overflow: hidden;
}

/* ---- Background pattern ---- */
.bg-pattern {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.025;
  background-image: radial-gradient(var(--ink-black) 1px, transparent 1px);
  background-size: 28px 28px;
}

.paper-texture {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 15% 20%, rgba(192,86,33,0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 85% 80%, rgba(43,108,176,0.04) 0%, transparent 50%);
}

/* ---- Main ---- */
.loader-main {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 28rem;
  width: 100%;
  padding: 1.5rem;
}

/* ---- Logo area ---- */
.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin-bottom: 2rem;
}

.typewriter-line {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  color: var(--accent-blue);
  letter-spacing: 0.05em;
  min-height: 1.8rem;
}

.caret {
  animation: blink-caret 0.8s step-end infinite;
  color: var(--accent-orange);
}

@keyframes blink-caret {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ---- Divider ---- */
.divider {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2rem;
  color: var(--beige-dark);
  font-size: 1.25rem;
  opacity: 0.6;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--beige-dark);
  margin: 0 1rem;
}

/* ---- Fact card (book page) ---- */
.fact-card {
  width: 100%;
  background: var(--surface);
  border: 1px solid var(--beige-dark);
  border-radius: 2px;
  padding: 1.5rem 1.75rem;
  position: relative;
  box-shadow:
    2px 2px 8px rgba(0,0,0,0.06),
    inset 0 0 30px rgba(160,156,143,0.08);
  overflow: hidden;
}

/* Left border accent like a book spine */
.fact-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 3px;
  height: 100%;
  background: var(--beige-dark);
}

/* Top decorative line */
.fact-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(to right, var(--beige-dark), transparent);
}

.fact-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.fact-icon {
  font-size: 1rem;
  color: var(--beige-shadow);
}

.fact-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--beige-shadow);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  font-family: var(--font-serif);
}

.fact-text {
  font-size: 1.1rem;
  font-weight: 400;
  color: var(--ink-black);
  line-height: 1.8;
  min-height: 5rem;
  display: flex;
  align-items: center;
  margin: 0 0 1rem;
  font-style: italic;
  animation: page-flip 0.5s ease-out;
}

@keyframes page-flip {
  from {
    opacity: 0;
    transform: perspective(600px) rotateY(-8deg);
  }
  to {
    opacity: 1;
    transform: perspective(600px) rotateY(0deg);
  }
}

.fact-progress-track {
  width: 100%;
  height: 2px;
  background: var(--beige-main);
  overflow: hidden;
}

.fact-progress-fill {
  height: 100%;
  background: var(--accent-orange);
  transition: width 0.05s linear;
}

/* ---- Loading text ---- */
.loading-text {
  color: var(--beige-shadow);
  font-size: 0.875rem;
  font-family: var(--font-mono);
  letter-spacing: 0.05em;
  margin: 1.25rem 0 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.loading-dots span {
  display: inline-block;
  animation: dot-rise 1.4s ease-in-out infinite;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dot-rise {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
</style>

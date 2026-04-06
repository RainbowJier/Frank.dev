<template>
  <div class="brand-logo" :style="{ gap: gap }">
    <span class="logo-icon-wrapper" :style="{ fontSize: size }">
      <svg class="animated-duck brand-img" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
        <g class="duck-all">
          <g class="leg-back">
            <rect x="135" y="140" width="16" height="40" fill="#CD7712" />
            <rect x="119" y="168" width="35" height="15" rx="7.5" fill="#CD7712" />
          </g>
          <g class="leg-front">
            <rect x="100" y="140" width="16" height="40" fill="#CD7712" />
            <rect x="84" y="168" width="35" height="15" rx="7.5" fill="#CD7712" />
          </g>
          <g class="duck-body">
            <circle cx="190" cy="85" r="12" fill="#FFB642" />
            <rect x="50" y="65" width="145" height="85" rx="42.5" fill="#FFB642" />
            <circle cx="85" cy="55" r="40" fill="#FFB642" />
          </g>
          <path class="wing" d="M 80 100 A 45 42 0 0 0 170 100 Z" fill="#FCA01D" />
          <rect class="beak" x="25" y="55" width="48" height="24" rx="12" fill="#E4881A" />
          <circle class="eye" cx="80" cy="40" r="5" fill="#3A4A5A" />
        </g>
      </svg>
    </span>
    <span class="logo-text" :style="{ fontSize: textSize, color: textColor }">{{ title }}</span>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    default: "Frank.dev",
  },
  size: {
    type: String,
    default: "32px",
  },
  textSize: {
    type: String,
    default: "2rem",
  },
  gap: {
    type: String,
    default: "12px",
  },
  textColor: {
    type: String,
    default: "var(--text-main-light, #1f2937)",
  }
});
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap");

.brand-logo {
  display: flex;
  align-items: center;
}

.logo-icon-wrapper {
  display: flex;
  align-items: center;
  color: var(--text-main-light, #1f2937);
}

.brand-img {
  width: 1em;
  height: 1em;
  object-fit: contain;
}

.logo-text {
  font-weight: 700;
  font-family: "EB Garamond", serif;
  white-space: nowrap;
}

/* === 鸭子动画核心 CSS === */
.animated-duck {
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15));
  overflow: visible;
}

.duck-all {
  animation: duck-bob 2s ease-in-out infinite;
}
@keyframes duck-bob {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-12px); }
}

.eye {
  transform-origin: 80px 40px;
  animation: duck-blink 4.5s infinite;
}
@keyframes duck-blink {
  0%, 95%, 98%, 100% { transform: scaleY(1); }
  96%, 99% { transform: scaleY(0.1); }
}

.wing {
  transform-origin: 125px 100px;
  animation: duck-flap 1.5s ease-in-out infinite;
}
@keyframes duck-flap {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-12deg); }
}

.leg-front {
  transform-origin: 108px 140px;
  animation: duck-walk-front 2s ease-in-out infinite;
}
.leg-back {
  transform-origin: 143px 140px;
  animation: duck-walk-back 2s ease-in-out infinite;
}
@keyframes duck-walk-front {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(15deg); }
}
@keyframes duck-walk-back {
  0%, 100% { transform: rotate(15deg); }
  50% { transform: rotate(0deg); }
}
</style>

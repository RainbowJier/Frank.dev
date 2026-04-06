<template>
  <div class="page-container">
    <main class="main-content">
      <div class="content-grid">
        <div class="text-section">
          <div class="error-badge">
            <span class="pulse-dot"></span>
            Error 404
          </div>

          <h1 class="hero-title">
            Page Not<br/>
            <span class="italic">Found.</span>
          </h1>

          <p class="hero-description">
            This page seems to have wandered off into the digital void. It might have been moved, deleted, or is just playing hide and seek.
          </p>

          <div class="action-buttons">
            <router-link to="/" class="btn">
              Back to Home
            </router-link>
            <router-link to="/" class="btn btn-outline">
              Browse Courses
            </router-link>
          </div>
        </div>

        <div class="graphic-section">
          <div class="card-wrapper">
            <div class="card-404">
              <div class="card-header">
                <div class="window-dot dot-red"></div>
                <div class="window-dot dot-yellow"></div>
                <div class="window-dot dot-green"></div>
                <span class="card-title">Error.log</span>
              </div>
              <div class="card-body">
                <div class="crt-lines">
                  <div class="crt-line"><span class="line-prefix">&gt;</span> PAGE_NOT_FOUND</div>
                  <div class="crt-line"><span class="line-prefix">&gt;</span> Status: <span class="text-error">404</span></div>
                  <div class="crt-line"><span class="line-prefix">&gt;</span> Path: /unknown<span class="cursor-blink">_</span></div>
                  <div class="crt-line dim"><span class="line-prefix">&gt;</span> Searching...</div>
                  <div class="crt-line dim"><span class="line-prefix">&gt;</span> No results found.</div>
                  <div class="crt-line"><span class="line-prefix">&gt;</span> <span class="text-hint">Try going back to Home.</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <SimpleFooter>
      <p>&copy; 2026 Frank.dev. All rights reserved. Even the missing ones.</p>
    </SimpleFooter>
  </div>
</template>

<script setup>
import SimpleFooter from "@/components/SimpleFooter.vue";
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=VT323&display=swap");

.page-container {
  --beige-light: #F0EDE0;
  --beige-main: #E0DCCF;
  --beige-dark: #C4C0B3;
  --beige-shadow: #A09C8F;
  --screen-black: #222529;
  --ink-black: #0f0f0f;
  --accent-blue: #2B6CB0;
  --accent-orange: #C05621;
  --font-serif: 'EB Garamond', serif;
  --font-mono: 'VT323', monospace;

  background-color: #f4f1e6;
  color: var(--ink-black);
  font-family: var(--font-serif);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Main Content */
.main-content {
  flex-grow: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 3rem 4rem;
}

.content-grid {
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column-reverse;
  gap: 3rem;
  align-items: center;
}

@media (min-width: 1024px) {
  .content-grid {
    flex-direction: row;
    justify-content: space-between;
  }
}

/* Text Section */
.text-section {
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  flex: 1;
}

@media (min-width: 1024px) {
  .text-section {
    text-align: left;
    align-items: flex-start;
  }
}

.error-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background-color: var(--beige-light);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 1px solid var(--beige-shadow);
  color: var(--accent-orange);
  font-family: var(--font-mono);
  font-size: 0.9rem;
  letter-spacing: 1px;
  box-shadow: inset 1px 1px 2px rgba(0,0,0,0.05);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--accent-orange);
  animation: pulse-anim 2s ease-in-out infinite;
}

@keyframes pulse-anim {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.hero-title {
  font-family: var(--font-serif);
  font-weight: 500;
  font-size: 5rem;
  line-height: 0.9;
  letter-spacing: -2px;
  margin: 0;
}

@media (min-width: 768px) {
  .hero-title { font-size: 6rem; }
}

.hero-title .italic {
  font-style: italic;
}

.hero-description {
  font-size: 1.25rem;
  color: #666;
  max-width: 28rem;
  line-height: 1.5;
  margin: 0;
}

/* Buttons */
.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 0.5rem;
  width: 100%;
  justify-content: center;
}

@media (min-width: 640px) {
  .action-buttons { flex-direction: row; }
}

@media (min-width: 1024px) {
  .action-buttons { justify-content: flex-start; }
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: var(--ink-black);
  color: #f4f1e6;
  padding: 1rem 2rem;
  font-size: 1.125rem;
  text-decoration: none;
  border-radius: 8px;
  font-family: var(--font-serif);
  border: 2px solid var(--ink-black);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn:hover {
  background: transparent;
  color: var(--ink-black);
}

.btn.btn-outline {
  background: transparent;
  color: var(--ink-black);
}

.btn.btn-outline:hover {
  background: var(--ink-black);
  color: #f4f1e6;
}

/* Graphic Section — Terminal Card */
.graphic-section {
  display: flex;
  justify-content: center;
  position: relative;
  flex: 1;
  width: 100%;
}

.card-wrapper {
  position: relative;
  width: 100%;
  max-width: 420px;
}

.card-404 {
  background: var(--screen-black);
  border-radius: 12px;
  border: 3px solid var(--beige-dark);
  box-shadow:
    0 20px 60px rgba(0,0,0,0.2),
    inset 0 1px 0 rgba(255,255,255,0.1);
  width: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.card-header {
  height: 2.5rem;
  background: var(--beige-main);
  border-bottom: 1px solid var(--beige-shadow);
  display: flex;
  align-items: center;
  padding: 0 1rem;
  gap: 0.5rem;
}

.card-title {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--beige-shadow);
  margin-left: 0.5rem;
}

.window-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot-red { background-color: #e06060; }
.dot-yellow { background-color: #d4a830; }
.dot-green { background-color: #60a060; }

.card-body {
  padding: 1.5rem;
  position: relative;
}

.card-body::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background:
    linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.15) 50%),
    linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
  background-size: 100% 2px, 3px 100%;
  pointer-events: none;
  z-index: 1;
}

.crt-lines {
  font-family: var(--font-mono);
  font-size: 1rem;
  color: #a0a8b8;
  line-height: 1.8;
  position: relative;
  z-index: 2;
}

.crt-line {
  text-shadow: 0 0 4px rgba(160, 168, 184, 0.3);
}

.line-prefix {
  color: var(--accent-orange);
  margin-right: 0.5rem;
}

.text-error {
  color: #e06060;
  text-shadow: 0 0 6px rgba(224, 96, 96, 0.4);
}

.text-hint {
  color: #60a060;
  text-shadow: 0 0 6px rgba(96, 160, 96, 0.3);
}

.dim {
  opacity: 0.5;
}

.cursor-blink {
  animation: blink-cursor 1s step-end infinite;
  color: #fff;
  text-shadow: 0 0 6px rgba(255,255,255,0.5);
}

@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Responsive */
@media (max-width: 768px) {
  .main-content {
    padding: 2rem 1.5rem;
  }
  .hero-title {
    font-size: 3.5rem;
  }
  .card-wrapper {
    max-width: 340px;
  }
  .crt-lines {
    font-size: 0.85rem;
  }
}
</style>

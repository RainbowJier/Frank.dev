<template>
  <div class="home-container">
    <!-- Navbar -->
    <nav class="navbar">
      <router-link to="/" class="nav-brand" style="text-decoration: none;">
        <BrandLogo size="1.5rem" gap="0.5rem" textSize="1.5rem" />
      </router-link>
      <div class="nav-links">
        <a href="#" class="nav-link active">Home</a>
        <a href="#" class="nav-link">Courses</a>
        <a href="#" class="nav-link">Articles</a>
        <a href="#" class="nav-link">Projects</a>
        <a href="#" class="nav-link">About</a>
      </div>
      <div class="nav-actions">
        <button v-if="!isLoggedIn" class="btn btn-outline btn-sm" @click="router.push('/login')">Login</button>
        <button v-if="isLoggedIn" class="btn btn-sm" @click="handleLogout">Logout</button>
      </div>
    </nav>

    <!-- Hero Section -->
    <section class="hero-container">
      <div class="content-col">
        <h1>
          <span>Learn to Build</span>
          <span class="italic">Real Apps.</span>
        </h1>
        <p class="lead">
          Project-based courses for curious developers. Master frontend magic, backend logic, and ship products from scratch.
        </p>

        <div class="cta-group">
          <button class="btn">Start Learning Today</button>
          <button class="btn btn-outline">Browse Curriculum</button>
        </div>

        <div class="specs-grid">
          <div v-for="(stat, index) in stats" :key="index" class="spec-item">
            <h4>{{ stat.label }}</h4>
            <p>{{ stat.value }}</p>
          </div>
        </div>
      </div>

      <RetroComputer
        crtText="Welcome to Frank.dev. Your courses are loaded, your progress is tracked, and new content awaits. Ready to code?"
        :showKeyboard="true"
      />
    </section>

    <!-- Courses Section -->
    <section class="courses-section">
      <div class="section-header">
        <h2>Popular Courses</h2>
        <a href="#" class="view-all">View All →</a>
      </div>

      <div class="courses-grid">
        <article v-for="(course, index) in courses" :key="index" class="course-card">
          <div :class="['card-thumb', course.bgClass]">
            <span class="thumb-icon">{{ course.emoji }}</span>
            <div class="card-rating">★ {{ course.rating }}</div>
          </div>
          <div class="card-tags">
            <span class="tag">{{ course.tagText1 }}</span>
            <span class="tag">{{ course.tagText2 }}</span>
          </div>
          <h3>{{ course.title }}</h3>
          <p class="card-desc">{{ course.desc }}</p>
          <div class="card-footer">
            <span>{{ course.duration }}</span>
            <span>{{ course.students }} students</span>
          </div>
        </article>
      </div>
    </section>

    <SimpleFooter year="2026" company="Frank.dev" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/composables/auth/userAuth';
import { getToken } from '@/utils/auth';
import BrandLogo from '@/components/BrandLogo.vue';
import SimpleFooter from '@/components/SimpleFooter.vue';
import RetroComputer from '@/components/retro/RetroComputer.vue';

const router = useRouter();
const { logout } = useAuth();

const isLoggedIn = computed(() => !!getToken());

const handleLogout = async () => {
  await logout();
};

const stats = ref([
  { value: '25+', label: 'Courses' },
  { value: '12.5k', label: 'Students' },
  { value: '4.9', label: 'Avg Rating' }
]);

const courses = ref([
  {
    title: 'React from Scratch',
    desc: 'Build a solid foundation in React by building 5 real-world mini applications. No prior framework knowledge needed.',
    rating: '4.8',
    duration: '12h 30m',
    students: '1,204',
    bgClass: 'bg-sage',
    tagText1: 'Frontend',
    tagText2: 'Beginner',
    emoji: '⚛️'
  },
  {
    title: 'UI Design for Developers',
    desc: 'Learn the fundamental rules of UI design to make your side projects look professional instantly.',
    rating: '4.9',
    duration: '8h 15m',
    students: '892',
    bgClass: 'bg-amber',
    tagText1: 'UI/UX',
    tagText2: 'Intermediate',
    emoji: '🎨'
  },
  {
    title: 'Scalable Architecture',
    desc: 'Deep dive into microservices, database sharding, and caching strategies for high-scale apps.',
    rating: '5.0',
    duration: '18h 45m',
    students: '543',
    bgClass: 'bg-moss',
    tagText1: 'System Design',
    tagText2: 'Advanced',
    emoji: '🏗️'
  }
]);
</script>

<style scoped>
@import url("https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=VT323&display=swap");

.home-container {
  --beige-light: #F0EDE0;
  --beige-main: #E0DCCF;
  --beige-dark: #C4C0B3;
  --beige-shadow: #A09C8F;
  --ink-black: #0f0f0f;
  --accent-blue: #2B6CB0;
  --accent-orange: #C05621;
  --font-serif: 'EB Garamond', serif;
  --font-mono: 'VT323', monospace;
}

* {
  box-sizing: border-box;
}

a, button {
  transition: all 0.2s ease;
}

.home-container {
  background-color: #f4f1e6;
  color: var(--ink-black);
  font-family: 'EB Garamond', serif;
  min-height: 100vh;
  overflow-x: hidden;
  padding-top: 0;
}

/* Navbar */
.navbar {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 1rem 4rem;
  margin-bottom: 3rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-links {
  display: flex;
  gap: 2rem;
}

.nav-link {
  text-decoration: none;
  font-weight: 600;
  color: var(--beige-shadow);
  font-size: 1rem;
}

.nav-link:hover {
  color: var(--ink-black);
}

.nav-link.active {
  color: var(--ink-black);
  text-decoration: underline;
  text-underline-offset: 4px;
}

.nav-actions {
  display: flex;
  gap: 0.75rem;
}

/* Buttons */
.btn {
  display: inline-block;
  background: var(--ink-black);
  color: #f4f1e6;
  padding: 1rem 2rem;
  font-size: 1.25rem;
  text-decoration: none;
  border-radius: 8px;
  font-family: 'EB Garamond', serif;
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

.btn.btn-sm {
  padding: 0.5rem 1.25rem;
  font-size: 0.95rem;
}

/* Hero Section */
.hero-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 4rem 4rem;
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  align-items: center;
}

.content-col {
  padding-right: 2rem;
}

h1 {
  font-size: 5rem;
  line-height: 0.85;
  margin: 0 0 2rem 0;
  letter-spacing: -2px;
  font-weight: 500;
}

h1 span {
  display: block;
}

h1 .italic {
  font-style: italic;
  white-space: nowrap;
  margin-left: -4px;
}

.lead {
  font-size: 1.5rem;
  line-height: 1.2;
  margin-bottom: 2rem;
  max-width: 480px;
  letter-spacing: -0.5px;
  color: #444;
}

.cta-group {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 3rem;
}

/* Specs Grid */
.specs-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
  max-width: 400px;
}

.spec-item h4 {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-size: 0.8rem;
  color: var(--beige-shadow);
  font-weight: 600;
}

.spec-item p {
  margin: 0.5rem 0 0 0;
  font-family: var(--font-mono);
  font-size: 1.1rem;
  color: var(--ink-black);
}

/* Courses Section */
.courses-section {
  max-width: 1400px;
  margin: 0 auto;
  padding: 4rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2.5rem;
}

.section-header h2 {
  font-size: 2rem;
  font-weight: 600;
  margin: 0;
}

.view-all {
  color: var(--accent-blue);
  text-decoration: none;
  font-weight: 600;
  font-size: 1rem;
}

.view-all:hover {
  text-decoration: underline;
}

.courses-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2rem;
}

.course-card {
  background: var(--beige-light);
  border: 1px solid var(--beige-shadow);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: inset 1px 1px 3px rgba(255,255,255,0.5);
  transition: transform 0.2s, box-shadow 0.2s;
}

.course-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
}

.card-thumb {
  height: 140px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.25rem;
  position: relative;
}

.bg-sage { background: #E8E4D8; }
.bg-amber { background: #E5D5C0; }
.bg-moss { background: #D8E0D4; }

.thumb-icon {
  font-size: 3rem;
  opacity: 0.6;
}

.card-rating {
  position: absolute;
  top: 10px;
  right: 10px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  background: rgba(255,255,255,0.8);
  padding: 2px 8px;
  border-radius: 4px;
}

.card-tags {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.tag {
  background: var(--beige-dark);
  color: var(--ink-black);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
  text-transform: uppercase;
  font-family: var(--font-mono);
  letter-spacing: 0.5px;
}

.course-card h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 0.75rem 0;
}

.card-desc {
  color: #666;
  font-size: 0.9rem;
  line-height: 1.5;
  margin: 0 0 1.25rem 0;
}

.card-footer {
  margin-top: auto;
  border-top: 1px solid var(--beige-shadow);
  padding-top: 0.75rem;
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--beige-shadow);
}

/* Responsive */
@media (max-width: 1000px) {
  .hero-container {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    padding: 2rem;
  }
  .content-col {
    padding: 0;
    margin-bottom: 3rem;
    text-align: center;
  }
  .cta-group {
    justify-content: center;
  }
  .specs-grid {
    margin: 0 auto;
  }
  .navbar {
    padding: 1rem 2rem;
  }
  .nav-links {
    display: none;
  }
  .courses-section {
    padding: 2rem;
  }
  .courses-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .courses-grid {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 3rem;
  }
  .lead {
    font-size: 1.25rem;
  }
}
</style>

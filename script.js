// script.js

// Smooth scroll on anchor click (if anchors added later) document.querySelectorAll('a[href^="#"]').forEach(anchor => { anchor.addEventListener('click', function (e) { e.preventDefault(); document.querySelector(this.getAttribute('href')).scrollIntoView({ behavior: 'smooth' }); }); });

// Module card reveal on scroll const moduleCards = document.querySelectorAll('.module-card');

const observer = new IntersectionObserver(entries => { entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); } }); }, { threshold: 0.15 });

moduleCards.forEach(card => { observer.observe(card); });

// PET AI section animation const petAISection = document.querySelector('.petai-section'); if (petAISection) { const text = petAISection.querySelector('p'); text.style.opacity = 0; window.addEventListener('scroll', () => { const rect = petAISection.getBoundingClientRect(); if (rect.top < window.innerHeight - 100) { text.style.transition = 'opacity 1s ease'; text.style.opacity = 1; } }); }


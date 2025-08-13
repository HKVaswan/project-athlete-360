// Ensure all scripts run after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // 1. Initialize Lucide Icons
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
        console.log('Lucide icons initialized.');
    } else {
        console.warn('Lucide library not found or createIcons function missing. Icons may not render.');
    }

    // 2. Robust Smooth Scroll for Internal Anchor Links
    document.querySelectorAll('a[href]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            const targetAttr = this.getAttribute('target');

            if (href && href.startsWith('#') && href.length > 1 && !targetAttr && !href.startsWith('http') && !href.startsWith('mailto')) {
                e.preventDefault();
                const targetElement = document.querySelector(href);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth' });
                }
            }
        });
    });

    // 3. Module card reveal on scroll
    const moduleCards = document.querySelectorAll('.module-card');
    const moduleObserverOptions = {
        threshold: 0.15
    };

    const moduleObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                moduleObserver.unobserve(entry.target);
            }
        });
    }, moduleObserverOptions);

    moduleCards.forEach(card => {
        card.classList.add('hidden-card');
        moduleObserver.observe(card);
    });

    // 4. PA360.net Highlight Section Fade-in Animation
    const highlightSection = document.querySelector('.pa360-net-highlight');

    if (highlightSection) {
        const highlightObserverOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.1
        };

        const highlightObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('show');
                    observer.unobserve(entry.target);
                }
            });
        }, highlightObserverOptions);

        highlightObserver.observe(highlightSection);
    }

    // 5. Athlete AI section animation
    const petAISection = document.querySelector('.petai-section');
    if (petAISection) {
        const textElement = petAISection.querySelector('p');
        if (textElement) {
            textElement.classList.add('hidden-text');

            const petAIOptions = {
                root: null,
                rootMargin: '0px',
                threshold: 0.5
            };

            const petAIObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        textElement.classList.add('show-text');
                        observer.unobserve(entry.target);
                    }
                });
            }, petAIOptions);

            petAIObserver.observe(petAISection);
        }
    }

    // 6. About the Founder section animation
    const founderSection = document.querySelector('.about-founder');
    if (founderSection) {
        founderSection.classList.add('founder-hidden'); // add initial hidden class

        const founderObserverOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.2 // 20% visible
        };

        const founderObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('founder-visible');
                    observer.unobserve(entry.target);
                }
            });
        }, founderObserverOptions);

        founderObserver.observe(founderSection);
    }

});

document.addEventListener('DOMContentLoaded', function () {
  const btn = document.getElementById('pa360-menu-btn');
  const nav = document.getElementById('pa360-nav');

  if (!btn || !nav) return;

  btn.addEventListener('click', function () {
    const open = nav.classList.toggle('open');

    // accessibility: update aria-expanded on the button
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // close nav if clicked outside (mobile)
  document.addEventListener('click', function (e) {
    if (!nav.classList.contains('open')) return;
    if (btn.contains(e.target) || nav.contains(e.target)) return;
    nav.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  });
});


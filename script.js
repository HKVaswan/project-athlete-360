document.addEventListener('DOMContentLoaded', function() {

    // --- SMOOTH SCROLL FOR NAV LINKS ---
    const navLinks = document.querySelectorAll('.nav-links a, .cta-button, .cta-secondary');

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            // Check if it's an internal link
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetElement = document.getElementById(targetId);

                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            }
        });
    });

    // --- SCROLL-BASED ANIMATIONS ---
    const animationOptions = {
        root: null, // use the viewport as the root
        rootMargin: '0px',
        threshold: 0.2 // trigger when 20% of the element is visible
    };

    // Create the observer
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            // If the element is intersecting (visible)
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optional: stop observing the element once it's visible
                observer.unobserve(entry.target);
            }
        });
    }, animationOptions);

    // Get all elements that need to be animated
    const elementsToAnimate = document.querySelectorAll('.animate-on-scroll');

    // Observe each element
    elementsToAnimate.forEach(element => {
        observer.observe(element);
    });
    
    // --- STICKY HEADER BACKGROUND ---
    const header = document.querySelector('header');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            header.style.background = 'var(--background-dark)';
        } else {
            header.style.background = 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)';
        }
    });

});


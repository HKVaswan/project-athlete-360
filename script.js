// Ensure all scripts run after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {

    // 1. Initialize Lucide Icons
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
        console.log('Lucide icons initialized.');
    } else {
        console.warn('Lucide library not found or createIcons function missing. Icons may not render.');
    }

    // 2. Smooth scroll on anchor click
    // IMPORTANT: Ensure this ONLY applies to internal anchor links (e.g., href="#section-id")
    // and DOES NOT interfere with external links or other buttons.
    document.querySelectorAll('a[href]').forEach(anchor => { // Select all 'a' tags with an href
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');

            // Check if the href starts with '#' AND it's not just '#' (which often means a placeholder)
            if (href && href.startsWith('#') && href.length > 1) {
                e.preventDefault(); // Prevent default only for valid internal anchor links
                const targetElement = document.querySelector(href);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth' });
                }
            }
            // For all other links (external, mailto, etc.), allow default behavior
        });
    });

    // 3. Module card reveal on scroll
    const moduleCards = document.querySelectorAll('.module-card');
    const moduleObserverOptions = {
        threshold: 0.15 // Trigger when 15% of the element is visible
    };

    const moduleObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                moduleObserver.unobserve(entry.target); // Stop observing once animated
            }
        });
    }, moduleObserverOptions);

    moduleCards.forEach(card => {
        card.classList.add('hidden-card'); // Add a class to hide them initially via CSS
        moduleObserver.observe(card);
    });

    // 4. PA360.net Highlight Section Fade-in Animation
    const highlightSection = document.querySelector('.pa360-net-highlight');

    if (highlightSection) {
        const highlightObserverOptions = {
            root: null, // relative to the viewport
            rootMargin: '0px',
            threshold: 0.1 // Trigger when 10% of the element is visible
        };

        const highlightObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('show');
                    observer.unobserve(entry.target); // Stop observing once animated
                }
            });
        }, highlightObserverOptions);

        highlightObserver.observe(highlightSection);
    }

    // 5. Athlete AI section animation (using IntersectionObserver for better performance)
    const petAISection = document.querySelector('.petai-section');
    if (petAISection) {
        const textElement = petAISection.querySelector('p');
        if (textElement) {
            textElement.classList.add('hidden-text'); // Initially hide the text via CSS

            const petAIOptions = {
                root: null,
                rootMargin: '0px',
                threshold: 0.5 // Trigger when 50% of the section is visible
            };

            const petAIObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        textElement.classList.add('show-text'); // Add class to reveal
                        observer.unobserve(entry.target); // Stop observing
                    }
                });
            }, petAIOptions);

            petAIObserver.observe(petAISection);
        }
    }
});

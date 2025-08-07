document.addEventListener('DOMContentLoaded', () => {

    // --- Smooth Scrolling for Anchor Links ---
    // Selects all anchor links that start with '#'
    const smoothScrollLinks = document.querySelectorAll('a[href^="#"]');
    
    smoothScrollLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            // Prevent the default jump behavior
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // --- Fade-in Animation on Scroll ---
    // Select all elements with the class 'fade-in-section'
    const sectionsToFade = document.querySelectorAll('.fade-in-section');
    
    // Initial fade-in for elements already in view (like the header)
    const initialFadeIns = document.querySelectorAll('.fade-in');
    initialFadeIns.forEach(el => el.classList.add('visible'));

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // Stop observing the element once it's visible
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1 // Trigger when 10% of the element is visible
        });

        sectionsToFade.forEach(section => {
            observer.observe(section);
        });
    } else {
        // Fallback for older browsers: just show the sections
        sectionsToFade.forEach(section => section.classList.add('visible'));
    }
});

/**
 * Site behaviour. Roughly 3 KB, no dependencies, loaded as a module so it is
 * deferred by default.
 *
 * Three rules hold throughout:
 *   1. Every block guards its own elements. The old script.js bound a listener to
 *      a nav toggle that only exists on some pages, so on every other page it
 *      threw and killed everything after it. Nothing here can do that.
 *   2. JavaScript never queries a styling class. Behaviour hooks are `data-*`;
 *      state is `is-*`. A CSS rename cannot break a listener.
 *   3. Nothing here is required to read the page. If this file fails to load, the
 *      site is fully navigable, fully readable and fully themed by the OS.
 */

const root = document.documentElement;

/* -------------------------------------------------------------- theme toggle */

(function theme() {
    const toggle = document.querySelector("[data-theme-toggle]");
    if (!toggle) return;

    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

    const currentlyDark = () =>
        root.dataset.theme ? root.dataset.theme === "dark" : prefersDark.matches;

    // Both <meta name="theme-color"> tags are media-scoped so the browser chrome
    // is correct with JavaScript off. That also means they follow the OS forever,
    // so an explicit choice here has to re-point `media` instead. Passing null
    // hands control back to the media queries.
    const applyThemeColor = (theme) => {
        document.querySelectorAll("meta[data-theme-color]").forEach((meta) => {
            const kind = meta.dataset.themeColor;
            meta.media = theme
                ? kind === theme
                    ? "all"
                    : "not all"
                : `(prefers-color-scheme: ${kind})`;
        });
    };

    const sync = () => {
        const dark = currentlyDark();
        toggle.setAttribute("aria-pressed", String(dark));
        applyThemeColor(root.dataset.theme || null);
        // The accessible name stays "Dark theme" in both states. A name that
        // changes with state ("Light theme" / "Dark theme") is announced as a
        // different control each time, and aria-pressed already carries the state.
        const label = toggle.querySelector(".theme-toggle__label");
        if (label) label.textContent = "Dark theme";
    };

    toggle.addEventListener("click", () => {
        const next = currentlyDark() ? "light" : "dark";
        root.dataset.theme = next;
        try {
            localStorage.setItem("theme", next);
        } catch (e) {
            /* Private browsing. The toggle still works for this page view. */
        }
        sync();
    });

    prefersDark.addEventListener("change", () => {
        if (!root.dataset.theme) sync();
    });

    sync();
})();

/* -------------------------------------------------------------- mobile navigation */

(function navigation() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.querySelector("[data-nav]");
    if (!toggle || !nav) return;

    const focusableSelector = "a[href], button:not([disabled])";

    const setOpen = (open) => {
        toggle.setAttribute("aria-expanded", String(open));
        nav.classList.toggle("is-open", open);
        document.body.classList.toggle("is-nav-open", open);
    };

    toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        setOpen(open);
        if (open) nav.querySelector(focusableSelector)?.focus();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        if (toggle.getAttribute("aria-expanded") !== "true") return;
        setOpen(false);
        toggle.focus();
    });

    // Focus containment while the drawer is open. Deliberately a wrap rather than
    // a full inert-the-rest-of-the-page trap: the header and the theme toggle stay
    // reachable, which is what a reader actually expects from a menu.
    nav.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        if (toggle.getAttribute("aria-expanded") !== "true") return;

        const items = [...nav.querySelectorAll(focusableSelector)];
        if (!items.length) return;

        const first = items[0];
        const last = items[items.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            toggle.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            toggle.focus();
        }
    });

    // Restore the desktop state if the viewport grows while the drawer is open,
    // otherwise `is-nav-open` leaves body scroll locked on a layout that has no
    // drawer.
    window.matchMedia("(min-width: 48em)").addEventListener("change", (event) => {
        if (event.matches) setOpen(false);
    });
})();

/* -------------------------------------------------------------- scroll reveal */

(function reveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    // Honour the OS setting by not observing at all. Reduced motion is also
    // handled in CSS, but not creating the observer avoids doing work whose only
    // possible outcome is a no-op.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        targets.forEach((target) => target.classList.add("is-revealed"));
        return;
    }

    if (!("IntersectionObserver" in window)) {
        targets.forEach((target) => target.classList.add("is-revealed"));
        return;
    }

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-revealed");
                // Fire once. Re-hiding on scroll-up is the single most irritating
                // pattern in this category — the reader has already read it.
                observer.unobserve(entry.target);
            });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.01 }
    );

    targets.forEach((target) => observer.observe(target));
})();

/* -------------------------------------------------------------- skip link focus */

(function skipLink() {
    const link = document.querySelector(".skip-link");
    const main = document.getElementById("main");
    if (!link || !main) return;

    // Safari does not reliably move focus on a same-page fragment jump, which
    // silently makes the skip link do nothing for the users who need it most.
    link.addEventListener("click", () => {
        window.requestAnimationFrame(() => main.focus());
    });
})();

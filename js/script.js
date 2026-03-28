function mobileMenu() {
    var navbar = document.getElementsByTagName("navbar")[0];
    if (!navbar) {
        return;
    }

    navbar.classList.toggle("mobile");
}

document.addEventListener("DOMContentLoaded", function () {
    var navbar = document.getElementsByTagName("navbar")[0];
    if (!navbar) {
        return;
    }

    var links = navbar.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
        links[i].addEventListener("click", function () {
            if (window.innerWidth <= 800) {
                navbar.classList.remove("mobile");
            }
        });
    }

    window.addEventListener("resize", function () {
        if (window.innerWidth > 800) {
            navbar.classList.remove("mobile");
        }
    });
});

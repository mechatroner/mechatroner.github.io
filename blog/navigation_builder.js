var blog_posts = [
    { file_name: "hello_world.html", bar_title: "Hello World", date: "2025-02-15" },
    { file_name: "row_wrap.html", bar_title: "Row Wrapping", date: "2025-02-15" },
    { file_name: "how_i_made_this_site.html", bar_title: "How I made this site", date: "2025-02-18" }
];


function buildNavigationBar() {
    const navigationDiv = document.getElementById("navigation_bar");

    if (!navigationDiv) {
        console.error("Navigation div with id 'navigation_bar' not found.");
        return; // Exit if the navigation div doesn't exist
    }

    // Check if the navigation div has a ul. Create if it doesn't exist.
    let ul = navigationDiv.querySelector("ul");
    if (!ul) {
        ul = document.createElement("ul");
        navigationDiv.appendChild(ul);
    }


    // Clear existing list items (important for updates)
    ul.innerHTML = '';

    // Add the "Main Page" link (always present)
    const mainPageLi = document.createElement("li");
    const mainPageLink = document.createElement("a");
    mainPageLink.href = "/";
    mainPageLink.textContent = "Main Page";
    mainPageLi.appendChild(mainPageLink);
    ul.appendChild(mainPageLi);


    // Add links for each blog post
    for (const post of blog_posts) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = post.file_name;
        link.textContent = post.bar_title;
        li.appendChild(link);
        ul.appendChild(li);
        const date_footer = document.getElementById("date_stamp");
        date_footer.textContent = `${post.date} Mechatroner.`;
    }
}


// Call the function to build the navigation bar when the page loads
document.addEventListener("DOMContentLoaded", buildNavigationBar);

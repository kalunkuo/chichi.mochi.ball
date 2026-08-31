const gallery = document.getElementById("gallery");
const toggle = document.getElementById("view-toggle");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");

const IMAGE_FOLDER = "images/";

/* Extract prefix letter (e.g. "A" from "A1.png") */
function getPrefix(filename) {
  const match = filename.match(/^[A-Za-z]+/);
  return match ? match[0] : "other";
}

/* Stable hash generator for layout consistency */
function hashString(string) {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    hash = (hash << 5) - hash + string.charCodeAt(i);
    hash = hash | 0;
  }
  return hash;
}

function removeExtension(filename) {
  return filename.replace(/\.[^/.]+$/, "");
}


/* =========================================
   LOAD IMAGES
========================================= */

async function loadImages() {
  try {
    const response = await fetch("images.json");
    if (!response.ok) {
      throw new Error("Could not load images.json");
    }

    const images = await response.json();

    images.sort((a, b) =>
      a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );

    createGallery(images);
  } catch (error) {
    console.error(error);
    gallery.innerHTML = `
      <p style="padding:40px; color:#fff;">
        Could not load images. Make sure to run a local web server (http://localhost:8000).
      </p>
    `;
  }
}


/* =========================================
   CREATE GALLERY
========================================= */

function createGallery(images) {
  gallery.innerHTML = "";

  // Group images by letter prefix
  const groups = {};
  images.forEach((filename) => {
    const prefix = getPrefix(filename);
    if (!groups[prefix]) {
      groups[prefix] = [];
    }
    groups[prefix].push(filename);
  });

  // Render group rows
  Object.keys(groups).forEach((prefix) => {
    const row = document.createElement("div");
    row.classList.add("gallery-row");

    groups[prefix].forEach((filename) => {
      const figure = document.createElement("figure");
      figure.classList.add("painting");

      // Replace the size assignment inside groups[prefix].forEach loop:

      const seed = hashString(filename);
      const val = Math.abs(seed % 100);

      let size = 1;
      if (val > 88) size = 5;      // ~12% Panorama Feature (3x2)
      else if (val > 72) size = 4; // ~16% Large Hero (2x2)
      else if (val > 55) size = 3; // ~17% Tall (1x2)
      else if (val > 35) size = 2; // ~20% Wide (2x1)
      else size = 1;               // ~35% Standard (1x1)

      figure.classList.add(`size-${size}`);

      /* IMAGE */
      const img = document.createElement("img");
      img.alt = removeExtension(filename);
      img.loading = "lazy";

      // Attach listener BEFORE assigning src to prevent race conditions
      img.addEventListener("load", () => {
        img.classList.add("loaded");
      });

      img.src = IMAGE_FOLDER + filename;

      if (img.complete) {
        img.classList.add("loaded");
      }

      /* LABEL */
      const label = document.createElement("figcaption");
      label.className = "painting-name";
      label.textContent = removeExtension(filename);

      /* LIGHTBOX TRIGGER */
      figure.addEventListener("click", () => {
        openLightbox(filename);
      });

      figure.appendChild(img);
      figure.appendChild(label);
      row.appendChild(figure);
    });

    gallery.appendChild(row);
  });
}


/* =========================================
   SWITCH VIEW
========================================= */

toggle.addEventListener("click", () => {
  const isArtMode = gallery.classList.contains("art-mode");

  if (isArtMode) {
    gallery.classList.remove("art-mode");
    gallery.classList.add("grid-mode");
    document.body.style.overflow = "auto";
  } else {
    gallery.classList.remove("grid-mode");
    gallery.classList.add("art-mode");
    document.body.style.overflow = "hidden";
  }
});


/* =========================================
   LIGHTBOX & BLUR TOGGLE
========================================= */

function openLightbox(filename) {
  lightboxImage.src = IMAGE_FOLDER + filename;
  lightboxImage.alt = removeExtension(filename);
  
  lightbox.classList.add("active");
  gallery.classList.add("blurred"); // Blurs the entire background gallery
}

function closeLightbox() {
  lightbox.classList.remove("active");
  gallery.classList.remove("blurred"); // Removes blur
}

lightbox.addEventListener("click", closeLightbox);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});

/* START */
loadImages();
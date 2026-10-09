// Line-drawn faces for the camera room. The feature the student should move is inked in saffron.
const HEAD = '<path class="fa-head" d="M60 12c-24 0-40 18-40 44 0 30 18 52 40 52s40-22 40-52c0-26-16-44-40-44z"/>';
const EARS = '<path class="fa-soft" d="M20 58c-6 0-8 4-7 9 1 6 5 9 9 8M100 58c6 0 8 4 7 9-1 6-5 9-9 8"/>';
const NOSE = '<path class="fa-soft" d="M60 58v16c0 3-3 4-6 4"/>';

const FACES = {
  calm: `${HEAD}${EARS}
    <path class="fa-line" d="M34 45c5-4 12-5 18-2M68 43c6-3 13-2 18 2"/>
    <ellipse class="fa-fill" cx="43" cy="55" rx="3.2" ry="3.6"/><ellipse class="fa-fill" cx="77" cy="55" rx="3.2" ry="3.6"/>
    ${NOSE}<path class="fa-line" d="M48 89c8 4 16 4 24 0"/>`,
  frown: `${HEAD}${EARS}
    <path class="fa-hl" d="M33 44l18 6M87 44l-18 6"/>
    <path class="fa-hl thin" d="M57 44l1 7M63 44l-1 7"/>
    <path class="fa-line" d="M37 57c4-2 9-2 12 0M71 57c3-2 8-2 12 0"/>
    ${NOSE}<path class="fa-line" d="M49 91c7-2 15-2 22 0"/>`,
  press: `${HEAD}${EARS}
    <path class="fa-line" d="M34 45c5-4 12-5 18-2M68 43c6-3 13-2 18 2"/>
    <ellipse class="fa-fill" cx="43" cy="55" rx="3.2" ry="3.6"/><ellipse class="fa-fill" cx="77" cy="55" rx="3.2" ry="3.6"/>
    ${NOSE}<path class="fa-hl" d="M46 89h28"/><path class="fa-hl thin" d="M44 86c-2 1-2 5 0 6M76 86c2 1 2 5 0 6"/>`,
  down: `<g transform="translate(0 10) rotate(8 60 60)">${HEAD}${EARS}
    <path class="fa-line" d="M34 47c5-3 12-3 18 0M68 47c6-3 13-3 18 0"/>
    <path class="fa-hl" d="M37 58c4 3 9 3 12 0M71 58c3 3 8 3 12 0"/>
    ${NOSE}<path class="fa-line" d="M50 92c7 2 14 2 20 0"/></g>
    <path class="fa-paper" d="M22 112l70-6 6 12-72 2z"/><path class="fa-hl thin" d="M70 104l14-14"/>`,
};

export function faceArt(kind) {
  return `<svg class="faceart" viewBox="0 0 120 124" aria-hidden="true">${FACES[kind] || FACES.calm}</svg>`;
}

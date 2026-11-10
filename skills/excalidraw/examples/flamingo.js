draw(() => {
  // Flamingo-80B ("Flamingo"), from Alayrac et al. 2022, arXiv 2204.14198: §2, Appendix A.1, Tables 4 and 5.
  // One small square = one token / one feature vector.

  const sq = (id, bg, s = 14) => box(id, "", { w: s, h: s, bg, sw: 1 });
  const strip = (id, n, bg) => row(3, ...Array.from({ length: n }, (_, i) => sq(`${id}.${i}`, bg)));
  const grid = (id, r, c, bg) => col(3, ...Array.from({ length: r }, (_, i) => row(3, ...Array.from({ length: c }, (_, j) => sq(`${id}.${i}.${j}`, bg)))));
  const cap = (id, s) => text(id, s, { fs: 13, ink: "gray" });
  const head = (id, s) => text(id, s, { fs: 18 });
  const IMG = ["gray", "green", "orange"];  // φ = 0 (no image yet), image 1, image 2

  // the interleaved sequence of the paper's Figure 7 (words shown as tokens for readability)
  const words = ["<BOS>", "Cute", "pics", "of", "my", "pets", "!", "<EOC>", "<image>", "My", "puppy", "sitting", "in", "the", "grass", ".", "<EOC>",
    "<image>", "My", "cat", "looking", "very", "dignified", ".", "<EOC>"];
  let k = 0;
  const phi = words.map((w) => (w === "<image>" ? ++k : k));

  const sequence = col({ gap: 10, align: "start" },
    head("seq.h", "1. INPUT: interleaved text and images (the paper's Figure 7).  <image> marks where an image sits; <EOC> = end of chunk"),
    row({ gap: 4, align: "start" }, ...words.map((w, i) => col(4, box(`t${i}`, w, { fs: 13, bg: IMG[phi[i]] }), text(`phi${i}`, `φ=${phi[i]}`, { fs: 11, ink: "gray" })))),
    cap("seq.c", "φ(ℓ) = the last image before text token ℓ (0 = none). Token ℓ cross-attends to image φ(ℓ) only; earlier images reach it through the LM's self-attention."));

  // 2. one image through the frozen encoder, flattened
  const branch = (n, name) => col({ gap: 26, align: "center" },
    box(`img${n}`, `image ${n}  (${name})\nresized to 320 × 320 px`, { bg: IMG[n] }),
    box(`nf${n}`, "NFNet-F6 vision encoder\nFROZEN (435M), contrastively pretrained\nout: its final stage, a 2D grid of features", { bg: "gray" }),
    col(6, grid(`g${n}`, 5, 5, IMG[n]), cap(`g${n}.c`, "H × W feature grid (drawn 5 × 5)")),
    box(`te${n}`, "+ learned TEMPORAL embedding (an image = 1 frame)\nno spatial position encoding", { fs: 13 }),
    col(6, strip(`xf${n}`, 25, IMG[n]), cap(`xf${n}.c`, `X_f: flattened, H·W tokens`)));

  const LAT = (id) => col(3, ...Array.from({ length: 4 }, (_, i) => strip(`${id}.${i}`, 16, "violet")));
  const resampler = col({ gap: 26, align: "center" },
    head("rs.h", "2. PERCEIVER RESAMPLER  (trained, 194M; the same for 3B / 9B / 80B)"),
    cap("rs.c", "runs on each image by itself, same weights; any number of features in, always 64 tokens out"),
    row({ gap: 50, align: "center" }, col(6, LAT("lat"), cap("lat.c", "X: 64 learned latent queries (trained), each 1536 wide")),
    box("rs.kv", "Q = X  (64)\nK = V = concat(X_f, X)   (H·W + 64)\nthe latents' own keys and values sit beside the features'", { bg: "violet", align: "left" })),
    box("rs.att", "X = X + attention_i(q = X, kv = concat(X_f, X))\n16 heads, key / value dim 96", { bg: "violet", align: "left" }),
    box("rs.ffw", "X = X + ffw_i(X)\nhidden 4 × 1536, Squared ReLU", { bg: "violet", align: "left" }),
    cap("rs.n", "× 6 layers  (L = 6, D = 1536, H = 16)"));

  const visual = col({ gap: 40, align: "start" },
    head("vt.h", "visual tokens, per image"),
    col({ gap: 6, align: "start" }, grid("v1", 4, 16, "green"), cap("v1.c", "image 1: 64 tokens × 1536")),
    col({ gap: 6, align: "start" }, grid("v2", 4, 16, "orange"), cap("v2.c", "image 2: 64 tokens × 1536")));

  // 3. the language model: frozen Chinchilla 70B with 12 gated cross-attention blocks
  const lm = (id, s) => box(id, s, { bg: "gray" });
  const gx = (id, s) => box(id, s, { bg: "yellow" });
  const stack = col({ gap: 22, align: "center" },
    head("lm.h", "3. LANGUAGE MODEL  (Flamingo-80B)"),
    cap("lm.c", "frozen Chinchilla 70B: 80 blocks, D = 8192, 64 heads"),
    box("emb", "text token embeddings (frozen)\ny: one 8192-wide vector per text token", { bg: "blue" }),
    gx("gx1", "GATED XATTN-DENSE 1   (trained)"), lm("lm1", "LM blocks 1 – 7   (frozen)"),
    gx("gx2", "GATED XATTN-DENSE 2"), lm("lm8", "LM blocks 8 – 14"),
    box("lm.dots", "· · ·   one GATED XATTN-DENSE before every 7th block,\nstarting at block 1: 12 in all", { fs: 13, stroke: "dashed" }),
    gx("gx12", "GATED XATTN-DENSE 12"), lm("lm78", "LM blocks 78 – 80"),
    box("out", "next text token:  p(y_ℓ | y_<ℓ, x_≤ℓ)", { bg: "blue" }));

  const block = col({ gap: 22, align: "start" },
    head("gb.h", "inside one GATED XATTN-DENSE  (trained from scratch; D = 8192, 64 heads, key / value dim 128)"),
    row({ gap: 40, align: "end" },
      col({ gap: 6, align: "start" }, strip("gq", 10, "blue"), cap("gq.c", "y: the text tokens → Q")),
      col({ gap: 6, align: "start" }, strip("gk", 16, "green"), cap("gk.c", "x: image φ(ℓ)'s 64 visual tokens from 2. → K, V"))),
    box("ga", "y = y + tanh(α_xattn) · attention(q = y, kv = x)\nmasked: text token ℓ sees image φ(ℓ)'s 64 tokens only (see 4.)", { bg: "yellow", align: "left" }),
    box("gf", "y = y + tanh(α_dense) · ffw(y)\nhidden 4 × 8192, Squared ReLU", { bg: "yellow", align: "left" }),
    cap("gα", "α_xattn, α_dense: one learnable scalar each per block, initialised to 0.\ntanh(0) = 0, so at the start Flamingo computes exactly the frozen LM."),
    box("gl", "then the next frozen LM blocks:\ny = y + frozen_attention(q = y, kv = y)   (causal self-attention)\ny = y + frozen_ffw(y)", { bg: "gray", align: "left" }));

  // 4. the cross-attention mask: rows = text tokens, columns = visual tokens (8 of each image's 64 drawn)
  const SHOW = 8;
  const cell = (i, n, j) => sq(`m${i}.${n}.${j}`, phi[i] === n ? (n === 1 ? "#2f9e44" : "#f08c00") : "#f1f3f5", 12);
  const mask = col({ gap: 10, align: "start" },
    head("mk.h", "4. CROSS-ATTENTION MASK  (dark = visible)"),
    row({ gap: 18, align: "start" }, text("mk.c0", "text token", { fs: 12, ink: "gray" }), text("mk.c1", "image 1: 64 tokens (8 drawn)", { fs: 12, ink: "green" }), text("mk.c2", "image 2: 64 (8 drawn)", { fs: 12, ink: "orange" })),
    col(3, ...words.map((w, i) => row({ gap: 12, align: "center" },
      box(`mr${i}`, w, { fs: 11, w: 84, h: 18, sw: 1, bg: IMG[phi[i]] }),
      row(3, ...Array.from({ length: SHOW }, (_, j) => cell(i, 1, j))),
      row(3, ...Array.from({ length: SHOW }, (_, j) => cell(i, 2, j)))))),
    cap("mk.n", "φ = 0 rows see no image: their cross-attention adds nothing."));

  const sizes = text("sizes", [
    "THE THREE SIZES (Tables 4, 5)          frozen LM               GATED XATTN-DENSE                 vision (frozen)   resampler   total",
    "  Flamingo-3B                          1.4B, 24 blocks          24 (before every block), 1.2B      435M              194M        3.2B",
    "  Flamingo-9B                          7.1B, 40 blocks          10 (every 4th), 1.6B               435M              194M        9.3B",
    "  Flamingo (80B)                       70B, 80 blocks           12 (every 7th), 10B                435M              194M        80B",
    "",
    "Video: frames at 1 FPS (8 frames in training; 30 frames at 3 FPS at inference, the temporal embeddings interpolated), each frame through the encoder alone,",
    "then all frames' features flattened together into one X_f.   Up to 5 images per sequence in training; up to 32 at evaluation.",
  ].join("\n"), { fs: 13 });

  return [
    text("title", "Flamingo  (Alayrac et al., DeepMind 2022): a frozen vision encoder and a frozen LM, joined by a trained Perceiver Resampler and gated cross-attention", { fs: 26 }),
    sequence,
    row({ gap: 120, align: "start" }, branch(1, "the puppy"), branch(2, "the cat")),
    row({ gap: 120, align: "center" }, resampler, visual),
    row({ gap: 90, align: "start" }, stack, block, mask),
    sizes,

    arrow("img1", "t8", "sits at", { stroke: "dashed", ink: "green" }), arrow("img2", "t17", "sits at", { stroke: "dashed", ink: "orange" }),
    ...[1, 2].flatMap((n) => [arrow(`img${n}`, `nf${n}`), arrow(`nf${n}`, `g${n}.0.2`), arrow(`g${n}.4.2`, `te${n}`), arrow(`te${n}`, `xf${n}.12`)]),
    arrow("xf1.24", "rs.kv", "", { ink: "green" }), arrow("xf2.0", "rs.kv", "", { ink: "orange" }),
    arrow("lat.1.15", "rs.kv", "Q, K, V"), arrow("rs.kv", "rs.att"), arrow("rs.att", "rs.ffw"),
    arrow("rs.ffw", "v1.2.0", "image 1", { ink: "green" }), arrow("rs.ffw", "v2.1.0", "image 2", { ink: "orange" }),
    arrow("emb", "gx1"), arrow("gx1", "lm1"), arrow("lm1", "gx2"), arrow("gx2", "lm8"), arrow("lm8", "lm.dots"), arrow("lm.dots", "gx12"), arrow("gx12", "lm78"), arrow("lm78", "out"),
    arrow("gx1", "ga", "inside", { stroke: "dashed", ink: "gray" }),
    arrow("gq.c", "ga"), arrow("gk.c", "ga"), arrow("ga", "gf"), arrow("gf", "gl"),
  ];
}, { title: "flamingo" });

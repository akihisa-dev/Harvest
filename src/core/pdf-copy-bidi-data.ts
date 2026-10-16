// Copyright 2014 The PDFium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

// Original code copyright 2014 Foxit Software Inc. http://www.foxitsoftware.com
// Data derived from PDFium a84323421e94f484faca52dd9d027934eba42ab8:
// core/fxcrt/fx_ucddata.inc and the mirror table in core/fxcrt/fx_unicode.cpp.
// Only BMP bidi classes and mirror pairs are retained; no PDFium runtime is bundled.

export type PdfCopyDirection = "L" | "R" | "W" | "N";

const directionEnds = [
  "8W dN 1bW 22N 25W 2aN 3aW 40N 5aL 60N 7aL 7eN 84W 85N a0W",
  "a1N a5W a9N aaL acN adW afN b3W b4N b5L b8N b9W baL bfN d6L",
  "d7N f6L f7N 2b8L 2baN 2c1L 2cfN 2d1L 2dfN 2e4L 2edN 2eeL 2ffN 36fW 373L",
  "375N 377L 379N 37dL 385N 386L 387N 38aL 38bN 38cL 38dN 3a1L 3a2N 3f5L 3f6N",
  "482L 489W 525L 530N 556L 558N 55fL 560N 587L 588N 589L 58fN 590R 5bdW 5beR",
  "5bfW 5c0R 5c2W 5c3R 5c5W 5c6R 5c7W 5ffR 603W 605R 607N 608R 60aW 60bR 60cW",
  "60dR 60fN 61aW 64aR 65eW 65fR 66cW 66fR 670W 6d5R 6e4W 6e6R 6e8W 6e9N 6edW",
  "6efR 6f9W 70eR 70fW 710R 711W 72fR 74aW 7a5R 7b0W 7eaR 7f3W 7f5R 7f9N 815R",
  "819W 81aR 823W 824R 827W 828R 82dW 8ffR 902W 939L 93bN 93cW 940L 948W 94cL",
  "94dW 94eL 94fN 950L 955W 957N 961L 963W 972L 978N 97fL 980N 981W 983L 984N",
  "98cL 98eN 990L 992N 9a8L 9a9N 9b0L 9b1N 9b2L 9b5N 9b9L 9bbN 9bcW 9c0L 9c4W",
  "9c6N 9c8L 9caN 9ccL 9cdW 9ceL 9d6N 9d7L 9dbN 9ddL 9deN 9e1L 9e3W 9e5N 9f1L",
  "9f3W 9faL 9fbW a00N a02W a03L a04N a0aL a0eN a10L a12N a28L a29N a30L a31N",
  "a33L a34N a36L a37N a39L a3bN a3cW a3dN a40L a42W a46N a48W a4aN a4dW a50N",
  "a51W a58N a5cL a5dN a5eL a65N a6fL a71W a74L a75W a80N a82W a83L a84N a8dL",
  "a8eN a91L a92N aa8L aa9N ab0L ab1N ab3L ab4N ab9L abbN abcW ac0L ac5W ac6N",
  "ac8W ac9L acaN accL acdW acfN ad0L adfN ae1L ae3W ae5N aefL af0N af1W b00N",
  "b01W b03L b04N b0cL b0eN b10L b12N b28L b29N b30L b31N b33L b34N b39L b3bN",
  "b3cW b3eL b3fW b40L b44W b46N b48L b4aN b4cL b4dW b55N b56W b57L b5bN b5dL",
  "b5eN b61L b63W b65N b71L b81N b82W b83L b84N b8aL b8dN b90L b91N b95L b98N",
  "b9aL b9bN b9cL b9dN b9fL ba2N ba4L ba7N baaL badN bb9L bbdN bbfL bc0W bc2L",
  "bc5N bc8L bc9N bccL bcdW bcfN bd0L bd6N bd7L be5N bf2L bf8N bf9W c00N c03L",
  "c04N c0cL c0dN c10L c11N c28L c29N c33L c34N c39L c3cN c3dL c40W c44L c45N",
  "c48W c49N c4dW c54N c56W c57N c59L c5fN c61L c63W c65N c6fL c7eN c7fL c81N",
  "c83L c84N c8cL c8dN c90L c91N ca8L ca9N cb3L cb4N cb9L cbbN cbcW cc4L cc5N",
  "cc8L cc9N ccbL ccdW cd4N cd6L cddN cdeL cdfN ce1L ce3W ce5N cefL d01N d03L",
  "d04N d0cL d0dN d10L d11N d28L d29N d39L d3cN d40L d44W d45N d48L d49N d4cL",
  "d4dW d56N d57L d5fN d61L d63W d65N d75L d78N d7fL d81N d83L d84N d96L d99N",
  "db1L db2N dbbL dbcN dbdL dbfN dc6L dc9N dcaW dceN dd1L dd4W dd5N dd6W dd7N",
  "ddfL df1N df4L e00N e30L e31W e33L e3aW e3eN e3fW e46L e4eW e5bL e80N e82L",
  "e83N e84L e86N e88L e89N e8aL e8cN e8dL e93N e97L e98N e9fL ea0N ea3L ea4N",
  "ea5L ea6N ea7L ea9N eabL eacN eb0L eb1W eb3L eb9W ebaN ebcW ebdL ebfN ec4L",
  "ec5N ec6L ec7N ecdW ecfN ed9L edbN eddL effN f17L f19W f34L f35W f36L f37W",
  "f38L f39W f3dN f47L f48N f6cL f70N f7eW f7fL f84W f85L f87W f8bL f8fN f97W",
  "f98N fbcW fbdN fc5L fc6W fccL fcdN fd8L fffN 102cL 1030W 1031L 1037W 1038L 103aW",
  "103cL 103eW 1057L 1059W 105dL 1060W 1070L 1074W 1081L 1082W 1084L 1086W 108cL 108dW 109cL",
  "109dW 10c5L 10cfN 10fcL 10ffN 1248L 1249N 124dL 124fN 1256L 1257N 1258L 1259N 125dL 125fN",
  "1288L 1289N 128dL 128fN 12b0L 12b1N 12b5L 12b7N 12beL 12bfN 12c0L 12c1N 12c5L 12c7N 12d6L",
  "12d7N 1310L 1311N 1315L 1317N 135aL 135eN 135fW 137cL 137fN 138fL 139fN 13f4L 1400N 167fL",
  "1680N 169aL 169fN 16f0L 16ffN 170cL 170dN 1711L 1714W 171fN 1731L 1734W 1736L 173fN 1751L",
  "1753W 175fN 176cL 176dN 1770L 1771N 1773W 177fN 17b6L 17bdW 17c5L 17c6W 17c8L 17d3W 17daL",
  "17dbW 17dcL 17ddW 17dfN 17e9L 180aN 180dW 180fN 1819L 181fN 1877L 187fN 18a8L 18a9W 18aaL",
  "18afN 18f5L 18ffN 191cL 191fN 1922W 1926L 1928W 192bL 192fN 1931L 1932W 1938L 193bW 1945N",
  "196dL 196fN 1974L 197fN 19abL 19afN 19c9L 19cfN 19daL 19ffN 1a16L 1a18W 1a1bL 1a1dN 1a55L",
  "1a56W 1a57L 1a5eW 1a5fN 1a60W 1a61L 1a62W 1a64L 1a6cW 1a72L 1a7cW 1a7eN 1a7fW 1a89L 1a8fN",
  "1a99L 1a9fN 1aadL 1affN 1b03W 1b33L 1b34W 1b35L 1b3aW 1b3bL 1b3cW 1b41L 1b42W 1b4bL 1b4fN",
  "1b6aL 1b73W 1b7cL 1b7fN 1b81W 1ba1L 1ba5W 1ba7L 1ba9W 1baaL 1badN 1bb9L 1bffN 1c2bL 1c33W",
  "1c35L 1c37W 1c3aN 1c49L 1c4cN 1c7fL 1ccfN 1cd2W 1cd3L 1ce0W 1ce1L 1ce8W 1cecL 1cedW 1cf2L",
  "1cffN 1dbfL 1de6W 1dfcN 1dffW 1f15L 1f17N 1f1dL 1f1fN 1f45L 1f47N 1f4dL 1f4fN 1f57L 1f58N",
  "1f59L 1f5aN 1f5bL 1f5cN 1f5dL 1f5eN 1f7dL 1f7fN 1fb4L 1fb5N 1fbcL 1fbdN 1fbeL 1fc1N 1fc4L",
  "1fc5N 1fccL 1fcfN 1fd3L 1fd5N 1fdbL 1fdfN 1fecL 1ff1N 1ff4L 1ff5N 1ffcL 200aN 200dW 200eL",
  "200fR 202eN 2034W 2043N 2044W 205fN 2070W 2071L 2073N 207bW 207eN 207fL 208bW 208fN 2094L",
  "209fN 20b8W 20cfN 20f0W 2101N 2102L 2106N 2107L 2109N 2113L 2114N 2115L 2118N 211dL 2123N",
  "2124L 2125N 2126L 2127N 2128L 2129N 212dL 212eW 2139L 213bN 213fL 2144N 2149L 214dN 214fL",
  "215fN 2188L 2211N 2213W 2335N 237aL 2394N 2395L 2487N 249bW 24e9L 26abN 26acL 27ffN 28ffL",
  "2bffN 2c2eL 2c2fN 2c5eL 2c5fN 2ce4L 2ceaN 2ceeL 2cf1W 2cffN 2d25L 2d2fN 2d65L 2d6eN 2d6fL",
  "2d7fN 2d96L 2d9fN 2da6L 2da7N 2daeL 2dafN 2db6L 2db7N 2dbeL 2dbfN 2dc6L 2dc7N 2dceL 2dcfN",
  "2dd6L 2dd7N 2ddeL 2ddfN 2dffW 3004N 3007L 3020N 3029L 302fW 3030N 3035L 3037N 303cL 3040N",
  "3096L 3098N 309aW 309cN 309fL 30a0N 30faL 30fbN 30ffL 3104N 312dL 3130N 318eL 318fN 31b7L",
  "31efN 321cL 321fN 324fL 325fN 327bL 327eN 32b0L 32bfN 32cbL 32cfN 32feL 32ffN 3376L 337aN",
  "33ddL 33dfN 33feL 33ffN 4db5L 4dffN 9fcbL 9fffN a48cL a4cfN a60cL a60fN a62bL a63fN a65fL",
  "a661N a66eL a672W a67bN a67dW a67fN a697L a69fN a6efL a6f1W a6f7L a721N a787L a788N a78cL",
  "a7faN a801L a802W a805L a806W a80aL a80bW a824L a826W a827L a82fN a837L a839W a83fN a873L",
  "a87fN a8c3L a8c4W a8cdN a8d9L a8dfN a8f1W a8fbL a8ffN a925L a92dW a946L a951W a953L a95eN",
  "a97cL a97fN a982W a9b2L a9b3W a9b5L a9b9W a9bbL a9bcW a9cdL a9ceN a9d9L a9ddN a9dfL a9ffN",
  "aa28L aa2eW aa30L aa32W aa34L aa36W aa3fN aa42L aa43W aa4bL aa4cW aa4dL aa4fN aa59L aa5bN",
  "aa7bL aa7fN aaafL aab0W aab1L aab4W aab6L aab8W aabdL aabfW aac0L aac1W aac2L aadaN aadfL",
  "abbfN abe4L abe5W abe7L abe8W abecL abedW abefN abf9L abffN d7a3L d7afN d7c6L d7caN d7fbL",
  "dfffN fa2dL fa2fN fa6dL fa6fN fad9L faffN fb06L fb12N fb17L fb1cN fb1dR fb1eW fb28R fb29W",
  "fd3dR fd3fN fdcfR fdefW fdfcR fdfdN fdffR fe0fW fe1fN fe26W fe4fN fe50W fe51N fe52W fe54N",
  "fe55W fe5eN fe5fW fe61N fe63W fe68N fe6aW fe6fN fefeR feffW ff02N ff05W ff0aN ff1aW ff20N",
  "ff3aL ff40N ff5aL ff65N ffbeL ffc1N ffc7L ffc9N ffcfL ffd1N ffd7L ffd9N ffdcL ffdfN ffe1W",
  "ffe4N ffe6W ffefN fff8W fffdN ffffW",
].join(" ").split(" ").map(record => ({end: Number.parseInt(record.slice(0, -1), 16), direction: record.at(-1) as PdfCopyDirection}));

const mirrors = new Map<number, number>([
  [0x0028, 0x0029], [0x0029, 0x0028], [0x003c, 0x003e], [0x003e, 0x003c], [0x005b, 0x005d], [0x005d, 0x005b], [0x007b, 0x007d], [0x007d, 0x007b],
  [0x00ab, 0x00bb], [0x00bb, 0x00ab], [0x0f3a, 0x0f3b], [0x0f3b, 0x0f3a], [0x0f3c, 0x0f3d], [0x0f3d, 0x0f3c], [0x169b, 0x169c], [0x169c, 0x169b],
  [0x2018, 0x2019], [0x2019, 0x2018], [0x201c, 0x201d], [0x201d, 0x201c], [0x2039, 0x203a], [0x203a, 0x2039], [0x2045, 0x2046], [0x2046, 0x2045],
  [0x207d, 0x207e], [0x207e, 0x207d], [0x208d, 0x208e], [0x208e, 0x208d], [0x2208, 0x220b], [0x2209, 0x220c], [0x220a, 0x220d], [0x220b, 0x2208],
  [0x220c, 0x2209], [0x220d, 0x220a], [0x2215, 0x29f5], [0x223c, 0x223d], [0x223d, 0x223c], [0x2243, 0x22cd], [0x2252, 0x2253], [0x2253, 0x2252],
  [0x2254, 0x2255], [0x2255, 0x2254], [0x2264, 0x2265], [0x2265, 0x2264], [0x2266, 0x2267], [0x2267, 0x2266], [0x2268, 0x2269], [0x2269, 0x2268],
  [0x226a, 0x226b], [0x226b, 0x226a], [0x226e, 0x226f], [0x226f, 0x226e], [0x2270, 0x2271], [0x2271, 0x2270], [0x2272, 0x2273], [0x2273, 0x2272],
  [0x2274, 0x2275], [0x2275, 0x2274], [0x2276, 0x2277], [0x2277, 0x2276], [0x2278, 0x2279], [0x2279, 0x2278], [0x227a, 0x227b], [0x227b, 0x227a],
  [0x227c, 0x227d], [0x227d, 0x227c], [0x227e, 0x227f], [0x227f, 0x227e], [0x2280, 0x2281], [0x2281, 0x2280], [0x2282, 0x2283], [0x2283, 0x2282],
  [0x2284, 0x2285], [0x2285, 0x2284], [0x2286, 0x2287], [0x2287, 0x2286], [0x2288, 0x2289], [0x2289, 0x2288], [0x228a, 0x228b], [0x228b, 0x228a],
  [0x228f, 0x2290], [0x2290, 0x228f], [0x2291, 0x2292], [0x2292, 0x2291], [0x2298, 0x29b8], [0x22a2, 0x22a3], [0x22a3, 0x22a2], [0x22a6, 0x2ade],
  [0x22a8, 0x2ae4], [0x22a9, 0x2ae3], [0x22ab, 0x2ae5], [0x22b0, 0x22b1], [0x22b1, 0x22b0], [0x22b2, 0x22b3], [0x22b3, 0x22b2], [0x22b4, 0x22b5],
  [0x22b5, 0x22b4], [0x22b6, 0x22b7], [0x22b7, 0x22b6], [0x22c9, 0x22ca], [0x22ca, 0x22c9], [0x22cb, 0x22cc], [0x22cc, 0x22cb], [0x22cd, 0x2243],
  [0x22d0, 0x22d1], [0x22d1, 0x22d0], [0x22d6, 0x22d7], [0x22d7, 0x22d6], [0x22d8, 0x22d9], [0x22d9, 0x22d8], [0x22da, 0x22db], [0x22db, 0x22da],
  [0x22dc, 0x22dd], [0x22dd, 0x22dc], [0x22de, 0x22df], [0x22df, 0x22de], [0x22e0, 0x22e1], [0x22e1, 0x22e0], [0x22e2, 0x22e3], [0x22e3, 0x22e2],
  [0x22e4, 0x22e5], [0x22e5, 0x22e4], [0x22e6, 0x22e7], [0x22e7, 0x22e6], [0x22e8, 0x22e9], [0x22e9, 0x22e8], [0x22ea, 0x22eb], [0x22eb, 0x22ea],
  [0x22ec, 0x22ed], [0x22ed, 0x22ec], [0x22f0, 0x22f1], [0x22f1, 0x22f0], [0x22f2, 0x22fa], [0x22f3, 0x22fb], [0x22f4, 0x22fc], [0x22f6, 0x22fd],
  [0x22f7, 0x22fe], [0x22fa, 0x22f2], [0x22fb, 0x22f3], [0x22fc, 0x22f4], [0x22fd, 0x22f6], [0x22fe, 0x22f7], [0x2308, 0x2309], [0x2309, 0x2308],
  [0x230a, 0x230b], [0x230b, 0x230a], [0x2329, 0x232a], [0x232a, 0x2329], [0x2768, 0x2769], [0x2769, 0x2768], [0x276a, 0x276b], [0x276b, 0x276a],
  [0x276c, 0x276d], [0x276d, 0x276c], [0x276e, 0x276f], [0x276f, 0x276e], [0x2770, 0x2771], [0x2771, 0x2770], [0x2772, 0x2773], [0x2773, 0x2772],
  [0x2774, 0x2775], [0x2775, 0x2774], [0x27c3, 0x27c4], [0x27c4, 0x27c3], [0x27c5, 0x27c6], [0x27c6, 0x27c5], [0x27c8, 0x27c9], [0x27c9, 0x27c8],
  [0x27d5, 0x27d6], [0x27d6, 0x27d5], [0x27dd, 0x27de], [0x27de, 0x27dd], [0x27e2, 0x27e3], [0x27e3, 0x27e2], [0x27e4, 0x27e5], [0x27e5, 0x27e4],
  [0x27e6, 0x27e7], [0x27e7, 0x27e6], [0x27e8, 0x27e9], [0x27e9, 0x27e8], [0x27ea, 0x27eb], [0x27eb, 0x27ea], [0x27ec, 0x27ed], [0x27ed, 0x27ec],
  [0x27ee, 0x27ef], [0x27ef, 0x27ee], [0x2983, 0x2984], [0x2984, 0x2983], [0x2985, 0x2986], [0x2986, 0x2985], [0x2987, 0x2988], [0x2988, 0x2987],
  [0x2989, 0x298a], [0x298a, 0x2989], [0x298b, 0x298c], [0x298c, 0x298b], [0x298d, 0x2990], [0x298e, 0x298f], [0x298f, 0x298e], [0x2990, 0x298d],
  [0x2991, 0x2992], [0x2992, 0x2991], [0x2993, 0x2994], [0x2994, 0x2993], [0x2995, 0x2996], [0x2996, 0x2995], [0x2997, 0x2998], [0x2998, 0x2997],
  [0x29b8, 0x2298], [0x29c0, 0x29c1], [0x29c1, 0x29c0], [0x29c4, 0x29c5], [0x29c5, 0x29c4], [0x29cf, 0x29d0], [0x29d0, 0x29cf], [0x29d1, 0x29d2],
  [0x29d2, 0x29d1], [0x29d4, 0x29d5], [0x29d5, 0x29d4], [0x29d8, 0x29d9], [0x29d9, 0x29d8], [0x29da, 0x29db], [0x29db, 0x29da], [0x29f5, 0x2215],
  [0x29f8, 0x29f9], [0x29f9, 0x29f8], [0x29fc, 0x29fd], [0x29fd, 0x29fc], [0x2a2b, 0x2a2c], [0x2a2c, 0x2a2b], [0x2a2d, 0x2a2e], [0x2a2e, 0x2a2d],
  [0x2a34, 0x2a35], [0x2a35, 0x2a34], [0x2a3c, 0x2a3d], [0x2a3d, 0x2a3c], [0x2a64, 0x2a65], [0x2a65, 0x2a64], [0x2a79, 0x2a7a], [0x2a7a, 0x2a79],
  [0x2a7d, 0x2a7e], [0x2a7e, 0x2a7d], [0x2a7f, 0x2a80], [0x2a80, 0x2a7f], [0x2a81, 0x2a82], [0x2a82, 0x2a81], [0x2a83, 0x2a84], [0x2a84, 0x2a83],
  [0x2a8b, 0x2a8c], [0x2a8c, 0x2a8b], [0x2a91, 0x2a92], [0x2a92, 0x2a91], [0x2a93, 0x2a94], [0x2a94, 0x2a93], [0x2a95, 0x2a96], [0x2a96, 0x2a95],
  [0x2a97, 0x2a98], [0x2a98, 0x2a97], [0x2a99, 0x2a9a], [0x2a9a, 0x2a99], [0x2a9b, 0x2a9c], [0x2a9c, 0x2a9b], [0x2aa1, 0x2aa2], [0x2aa2, 0x2aa1],
  [0x2aa6, 0x2aa7], [0x2aa7, 0x2aa6], [0x2aa8, 0x2aa9], [0x2aa9, 0x2aa8], [0x2aaa, 0x2aab], [0x2aab, 0x2aaa], [0x2aac, 0x2aad], [0x2aad, 0x2aac],
  [0x2aaf, 0x2ab0], [0x2ab0, 0x2aaf], [0x2ab3, 0x2ab4], [0x2ab4, 0x2ab3], [0x2abb, 0x2abc], [0x2abc, 0x2abb], [0x2abd, 0x2abe], [0x2abe, 0x2abd],
  [0x2abf, 0x2ac0], [0x2ac0, 0x2abf], [0x2ac1, 0x2ac2], [0x2ac2, 0x2ac1], [0x2ac3, 0x2ac4], [0x2ac4, 0x2ac3], [0x2ac5, 0x2ac6], [0x2ac6, 0x2ac5],
  [0x2acd, 0x2ace], [0x2ace, 0x2acd], [0x2acf, 0x2ad0], [0x2ad0, 0x2acf], [0x2ad1, 0x2ad2], [0x2ad2, 0x2ad1], [0x2ad3, 0x2ad4], [0x2ad4, 0x2ad3],
  [0x2ad5, 0x2ad6], [0x2ad6, 0x2ad5], [0x2ade, 0x22a6], [0x2ae3, 0x22a9], [0x2ae4, 0x22a8], [0x2ae5, 0x22ab], [0x2aec, 0x2aed], [0x2aed, 0x2aec],
  [0x2af7, 0x2af8], [0x2af8, 0x2af7], [0x2af9, 0x2afa], [0x2afa, 0x2af9], [0x2e02, 0x2e03], [0x2e03, 0x2e02], [0x2e04, 0x2e05], [0x2e05, 0x2e04],
  [0x2e09, 0x2e0a], [0x2e0a, 0x2e09], [0x2e0c, 0x2e0d], [0x2e0d, 0x2e0c], [0x2e1c, 0x2e1d], [0x2e1d, 0x2e1c], [0x2e20, 0x2e21], [0x2e21, 0x2e20],
  [0x2e22, 0x2e23], [0x2e23, 0x2e22], [0x2e24, 0x2e25], [0x2e25, 0x2e24], [0x2e26, 0x2e27], [0x2e27, 0x2e26], [0x2e28, 0x2e29], [0x2e29, 0x2e28],
  [0x3008, 0x3009], [0x3009, 0x3008], [0x300a, 0x300b], [0x300b, 0x300a], [0x300c, 0x300d], [0x300d, 0x300c], [0x300e, 0x300f], [0x300f, 0x300e],
  [0x3010, 0x3011], [0x3011, 0x3010], [0x3014, 0x3015], [0x3015, 0x3014], [0x3016, 0x3017], [0x3017, 0x3016], [0x3018, 0x3019], [0x3019, 0x3018],
  [0x301a, 0x301b], [0x301b, 0x301a], [0xfe59, 0xfe5a], [0xfe5a, 0xfe59], [0xfe5b, 0xfe5c], [0xfe5c, 0xfe5b], [0xfe5d, 0xfe5e], [0xfe5e, 0xfe5d],
  [0xfe64, 0xfe65], [0xfe65, 0xfe64], [0xff08, 0xff09], [0xff09, 0xff08], [0xff1c, 0xff1e], [0xff1e, 0xff1c], [0xff3b, 0xff3d], [0xff3d, 0xff3b],
  [0xff5b, 0xff5d], [0xff5d, 0xff5b], [0xff5f, 0xff60], [0xff60, 0xff5f], [0xff62, 0xff63], [0xff63, 0xff62],
]);

export function pdfCopyDirection(codeUnit: number): PdfCopyDirection {
  let low = 0, high = directionEnds.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (codeUnit <= directionEnds[middle]!.end) high = middle;
    else low = middle + 1;
  }
  return directionEnds[low]!.direction;
}

export function pdfCopyMirror(codeUnit: number): number {
  return mirrors.get(codeUnit) ?? codeUnit;
}

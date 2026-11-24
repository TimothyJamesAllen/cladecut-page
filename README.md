# cladecut in your browser

A web page that reduces a large phylogenetic tree to representative tips, points out the clusters whose
representative is plainly wrong, and lets you make choices for the next run.

**Your files stay on your computer.** The method runs inside the browser; nothing is uploaded or sent anywhere,
and the page is not allowed to send anything.

## What it does

cladecut divides the tips of a rooted tree into whole clades and keeps the central tip of each clade as its
representative. Among all ways of dividing the tree into the number of clades you ask for, it returns the one that
brings the tips closest to their representatives: the summed tree distance from every tip to its representative is
the least possible.

## How to use it

1. **Open the page** in a desktop browser (Chrome, Firefox, Safari or Edge). A tree of 500,000 tips with names and
   an alignment needs about 1 GB of memory; a laptop is enough, a phone is not.
2. **Load your files**: the tree (Newick, rooted, with branch lengths), and if you have them a names table (a
   header line and one row per tip, for example with columns for family, genus and species) and an aligned FASTA
   file. The names table and the alignment may be gzipped. "Try a small simulated example" shows the page without
   any files.
3. **Set the number of representatives** (a share of the tips, or a number) and press **Run**.
4. **Look at the flagged clusters.** A cluster is flagged when its representative looks plainly wrong for it: it is
   the only tip of its family, genus or species while most of the cluster shares another; its sequence differs at
   more than 10% of sites from most of the cluster; it sits on one of the longest branches of the tree; or its
   sequence covers less than half the alignment while another tip's is complete. The plainest cases come first.
5. **Open a cluster** to see its tips, how far each is from the representative, and its part of the tree. Then:
   - **make representative**: this tip must represent its cluster;
   - **never**: this tip may never be a representative (for example a misidentified or misplaced sequence);
   - **split this cluster in two**: the cluster's two branches are kept apart, with one more representative.
6. **Run again with the choices.** The result is the best division that respects every choice.
7. **Save the choices** (`choices.tsv`) and send them back. The same choices give exactly the same result in the
   R package and its command, with `--choices choices.tsv`; the page shows the matching command line.

The page also offers the same files as the command writes: the cluster of every tip, the representatives, a
summary, the tree of the representatives, and the flags.

## Version

The page's version is shown at its foot and written into every choices file it saves. `SHA256SUMS` lists the
checksums of its files.

## Licence

GNU General Public License, version 3; see [`LICENSE`](LICENSE).

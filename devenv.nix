{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    pnpm.enable = true;
    pnpm.install.enable = true;
  };

  packages = with pkgs; [
    ffmpeg-full
    glib
    libGL
    pkg-config
  ];

  env = {
    LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [
      pkgs.glib
      pkgs.libGL
    ];
  };

  scripts = {
    domestique.exec = "pnpm exec tsx src/cli.ts \"$@\"";
    director.exec = "pnpm exec tsx src/cli.ts \"$@\"";
    test-director.exec = "pnpm test";
  };

  enterShell = ''
    echo "=========================================================="
    echo "  🚴 DOMESTIQUE: AI Director for 360° Cycling Footage     "
    echo "=========================================================="
    echo "  Node   : $(node -v)"
    echo "  pnpm   : $(pnpm -v)"
    echo "  FFmpeg : $(ffmpeg -version | head -n 1)"
    echo ""
    echo "  Usage:"
    echo "    pnpm domestique auto <input...> -o <output.mp4>"
    echo "    pnpm domestique plan <input...> -o edl.json"
    echo "    pnpm domestique render --edl edl.json -o <output.mp4>"
    echo "    pnpm test"
    echo "=========================================================="
  '';
}

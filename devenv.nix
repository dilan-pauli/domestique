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
    director.exec = "pnpm exec tsx src/cli.ts \"$@\"";
    test-director.exec = "pnpm test";
  };

  enterShell = ''
    echo "=========================================================="
    echo "  Insta360 Director Agent (TypeScript + Node 22)         "
    echo "=========================================================="
    echo "  Node   : $(node -v)"
    echo "  pnpm   : $(pnpm -v)"
    echo "  FFmpeg : $(ffmpeg -version | head -n 1)"
    echo ""
    echo "  Available Commands:"
    echo "    pnpm director auto <input...> -o <output.mp4>"
    echo "    pnpm director plan <input...> -o edl.json"
    echo "    pnpm director render <input...> --edl edl.json -o <output.mp4>"
    echo "    pnpm test"
    echo "=========================================================="
  '';
}

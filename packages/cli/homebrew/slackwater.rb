class Slackwater < Formula
  desc "Tide and current prediction command-line interface"
  homepage "https://github.com/{{REPO}}"
  # Installs the npm package on Homebrew's Node rather than the standalone binary,
  # so Homebrew supplies the runtime and its libraries on every platform it supports
  url "https://registry.npmjs.org/@slackwater/cli/-/cli-{{VERSION}}.tgz"
  sha256 "{{SHA256_NPM}}"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/slackwater --version")
  end
end

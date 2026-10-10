class Slackwater < Formula
  desc "Tide prediction command line interface"
  homepage "https://github.com/{{REPO}}"
  version "{{VERSION}}"
  license "MIT"

  on_macos do
    url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-darwin-arm64.tar.gz"
    sha256 "{{SHA256_DARWIN_ARM64}}"
  end

  on_linux do
    url "https://github.com/{{REPO}}/releases/download/{{TAG}}/slackwater-linux-x64.tar.gz"
    sha256 "{{SHA256_LINUX_X64}}"
  end

  def install
    bin.install "slackwater"
    prefix.install "LICENSE", "NOTICE"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/slackwater --version")
  end
end

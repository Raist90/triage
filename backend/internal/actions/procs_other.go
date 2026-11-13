//go:build !unix

package actions

import (
	"os/exec"
	"syscall"
)

func processGroupAttr() *syscall.SysProcAttr { return nil }

func killProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

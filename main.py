"""
BMW K+DCAN Diagnostic Tool - Main Entry Point
Open-source BMW diagnostic software for K+DCAN cables.
"""
import sys
import os
import logging

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import Qt
from bmw_diag.gui.main_window import MainWindow
from bmw_diag.utils.logger import setup_logging


def main():
    setup_logging()
    logger = logging.getLogger(__name__)
    logger.info("Starting BMW K+DCAN Diagnostic Tool")

    # Enable high DPI scaling
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName("BMW K+DCAN Diagnostic Tool")
    app.setApplicationVersion("1.0.0")
    app.setOrganizationName("OpenDiag")

    # Apply dark theme
    from bmw_diag.gui.styles.dark_theme import get_dark_theme
    app.setStyleSheet(get_dark_theme())

    window = MainWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

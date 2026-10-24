"""Kelas Fotosintesis — proses perubahan cahaya menjadi energi kimia.

Persamaan umum:

    6 CO2 + 6 H2O  --cahaya, klorofil-->  C6H12O6 + 6 O2

Model laju di kelas ini memakai pendekatan faktor pembatas (Blackman):

    P = Pmax x f(cahaya) x f(CO2) x f(suhu) x f(air)

Laju hanya dibatasi oleh faktor yang paling lemah — persis seperti yang
dimodelkan simulasi interaktif ``laju-fotosintesis.html``, sehingga angka
yang dihasilkan kelas dan simulasi bisa dibandingkan langsung.

Jalankan demo cepat:

    python3 fotosintesis.py
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Faktor = Literal["cahaya", "CO2", "suhu", "air"]


@dataclass(frozen=True)
class Hasil:
    """Hasil satu evaluasi laju."""

    laju: float
    faktor_pembatas: Faktor | str
    faktor: dict[str, float]


class Fotosintesis:
    """Proses fotosintesis pada tumbuhan hijau.

    Args:
        pmax: laju maksimum (µmol O2 / m² / detik) saat semua faktor ideal.
    """

    #: Reaksi bersih (glukosa + oksigen sebagai hasil utama).
    PERSAMAAN = "6CO2 + 6H2O --cahaya--> C6H12O6 + 6O2"

    #: Zat yang dibutuhkan (reaktan).
    BAHAN = ("karbon dioksida", "air", "cahaya")

    #: Zat yang dihasilkan (produk).
    HASIL = ("glukosa", "oksigen")

    #: Panjang gelombang yang diserap klorofil, dalam nanometer.
    PITA_KLOROFIL = (430.0, 453.0, 642.0, 662.0)

    #: Laju maksimum simulasi (µmol O2 / m² / detik).
    PMAX = 32.0

    def __init__(self, pmax: float = PMAX) -> None:
        if pmax <= 0:
            raise ValueError("pmax harus positif")
        self.pmax = float(pmax)

    # ------------------------------------------------------------------
    # Kotentang
    # ------------------------------------------------------------------
    @property
    def persamaan(self) -> str:
        return self.PERSAMAAN

    @property
    def bahan(self) -> tuple[str, ...]:
        return self.BAHAN

    @property
    def hasil(self) -> tuple[str, ...]:
        return self.HASIL

    @property
    def pita_klorofil(self) -> tuple[float, ...]:
        return self.PITA_KLOROFIL

    @staticmethod
    def tahapan() -> tuple[str, ...]:
        """Dua tahap utama yang berlangsung di kloroplas."""
        return ("Reaksi terang (membran tilakoid)", "Siklus Calvin (stroma)")

    @staticmethod
    def lokasi_tahapan() -> dict[str, str]:
        return {
            "Reaksi terang (membran tilakoid)": "membran tilakoid",
            "Siklus Calvin (stroma)": "stroma kloroplas",
        }

    # ------------------------------------------------------------------
    # Faktor pembatas
    # ------------------------------------------------------------------
    @staticmethod
    def f_cahaya(light: float) -> float:
        """Jenuh Manning: laju tidak pernah linear terhadap cahaya."""
        return light / (light + 200) if light > 0 else 0.0

    @staticmethod
    def f_co2(co2: float) -> float:
        """Di bawah 50 ppm fotosintesis berhenti (titik kompensasi)."""
        return 0.0 if co2 <= 50 else (co2 - 50) / (co2 + 350)

    @staticmethod
    def f_suhu(temp: float, optimal: float = 25.0, sigma: float = 7.5) -> float:
        """Lingkup Gaussian di sekitar suhu optimum, anjlok di ekstrem."""
        f = math.exp(-((temp - optimal) ** 2) / (2 * sigma**2))
        if temp <= 5 or temp >= 45:
            f *= 0.2
        return f

    @staticmethod
    def f_air(water: float) -> float:
        """Kelembapan tanah 0–100; di bawah 70% stomata menutup."""
        return max(0.0, min(water, 100) / 100) ** 0.7

    # ------------------------------------------------------------------
    # Laju
    # ------------------------------------------------------------------
    def laju(
        self,
        *,
        cahaya: float = 600.0,
        co2: float = 400.0,
        suhu: float = 25.0,
        air: float = 70.0,
    ) -> Hasil:
        """Hitung laju fotosintesis dan faktor pembatasnya.

        Args:
            cahaya: intensitas cahaya, µmol / m² / detik.
            co2: konsentrasi CO2, ppm.
            suhu: suhu udara, °C.
            air: kelembapan tanah, 0–100.

        Returns:
            Hasil berisi laju, nama faktor pembatas, dan tiap faktor.
        """
        if cahaya < 0 or co2 < 0:
            raise ValueError("cahaya dan co2 tidak boleh negatif")

        faktor = {
            "cahaya": self.f_cahaya(cahaya),
            "CO2": self.f_co2(co2),
            "suhu": self.f_suhu(suhu),
            "air": self.f_air(air),
        }
        laju = self.pmax
        for nilai in faktor.values():
            laju *= nilai

        return Hasil(
            laju=round(laju, 2),
            faktor_pembatas=self._pembatas(faktor, cahaya=cahaya, suhu=suhu),
            faktor={k: round(v, 4) for k, v in faktor.items()},
        )

    def faktor_pembatas(
        self,
        *,
        cahaya: float = 600.0,
        co2: float = 400.0,
        suhu: float = 25.0,
        air: float = 70.0,
    ) -> tuple[float, Faktor | str]:
        """Versi ringkas: kembalikan (laju, faktor_pembatas)."""
        hasil = self.laju(cahaya=cahaya, co2=co2, suhu=suhu, air=air)
        return hasil.laju, hasil.faktor_pembatas

    @staticmethod
    def _pembatas(faktor: dict[str, float], *, cahaya: float, suhu: float) -> Faktor | str:
        if cahaya == 0:
            return "gelap — tanpa cahaya"
        nama = min(faktor, key=lambda k: faktor[k])
        if nama != "suhu":
            return nama
        if suhu > 30:
            return "suhu (terlalu panas)"
        if suhu < 18:
            return "suhu (terlalu dingin)"
        return nama

    # ------------------------------------------------------------------
    # Analisis
    # ------------------------------------------------------------------
    def serapan(self, panjang: float) -> float:
        """Gunakan panjang gelombang diserap: 1.0, di luar pita: 0.0."""
        toleransi = 20.0
        for pusat in self.PITA_KLOROFIL:
            if abs(panjang - pusat) <= toleransi:
                return 1.0
        return 0.0

    def titik_kompensasi(
        self,
        *,
        respirasi: float = 1.0,
        co2: float = 400.0,
        suhu: float = 25.0,
        air: float = 70.0,
    ) -> float | None:
        """Intensitas cahaya saat fotosintesis = respirasi (titik kompensasi).

        Args:
            respirasi: laju respirasi, µmol O2 / m² / detik.
            co2: konsentrasi CO2, ppm.
            suhu: suhu udara, °C.
            air: kelembapan tanah, 0–100.

        Returns:
            Intensitas cahaya, atau None bila tidak tercapai karena salah
            satu faktor sudah nol (misalnya gelap atau CO2 di bawah 50 ppm).
        """
        if respirasi < 0:
            raise ValueError("respirasi tidak boleh negatif")
        # terhadap cahaya: laju = pmax * f(L) * K
        k = self.f_co2(co2) * self.f_suhu(suhu) * self.f_air(air)
        if k <= 0:
            return None
        # f(L) = L / (L + 200)  ->  L = 200t / (1 - t)
        t = respirasi / (self.pmax * k)
        if t >= 1:
            return None
        return round(200 * t / (1 - t), 2)


def demo() -> None:
    f = Fotosintesis()

    print("=" * 62)
    print("PROSES FOTOSINTESIS")
    print("=" * 62)
    print(f"Persamaan : {f.persamaan}")
    print(f"Bahan     : {', '.join(f.bahan)}")
    print(f"Hasil     : {', '.join(f.hasil)}")
    print(f"Pita klorofil (nm) : {', '.join(f'{p:g}' for p in f.pita_klorofil)}")
    print("\nTahapan:")
    for nama, lokasi in f.lokasi_tahapan().items():
        print(f"  - {nama} -> {lokasi}")

    print("\nSkenario laju (µmol O2 / m² / detik)")
    print(f"{'cahaya':>8}{'CO2':>7}{'suhu':>7}{'air':>6}{'laju':>8}  {'pembatas':<26} keterangan")
    print("-" * 88)
    skenario = [
        (600, 400, 25, 70, "kondisi ideal"),
        (0, 400, 25, 70, "cahaya dimatikan"),
        (2000, 400, 25, 70, "cahaya 3x lipat, laju tak sebanding"),
        (600, 150, 25, 70, "CO2 di bawah titik kompensasi"),
        (600, 400, 42, 70, "enzim mulai denaturasi"),
        (600, 400, 10, 20, "stomata menutup, air kurang"),
    ]
    for cahaya, co2, suhu, air, catatan in skenario:
        h = f.laju(cahaya=cahaya, co2=co2, suhu=suhu, air=air)
        print(
            f"{cahaya:>8.0f}{co2:>7.0f}{suhu:>7.0f}{air:>6.0f}"
            f"{h.laju:>8.2f}  {h.faktor_pembatas:<26} {catatan}"
        )

    print("\nSerapan cahaya pada 450 nm vs 550 nm:",
          f.serapan(450), "dan", f.serapan(550))
    print("Titik kompensasi (respirasi 1, CO2 400, 25 °C):",
          f.titik_kompensasi(), "µmol/m²/s")
    print("Titik kompensasi saat CO2 20 ppm:",
          f.titik_kompensasi(co2=20), "µmol/m²/s")
    print("=" * 62)


if __name__ == "__main__":
    demo()

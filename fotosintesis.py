import math

class Fotosintesis:
    """Proses fotosintesis pada tumbuhan.

    Model laju selaras dengan simulasi interaktif laju-fotosintesis.html:
    P = Pmax * f(light) * f(co2) * f(temp) * f(water).
    """

    PMAX = 32.0

    def __init__(self):
        self.bahan = ["air", "karbondioksida", "cahaya"]
        self.hasil = ["glukosa", "oksigen"]

    def reaksi(self):
        return "6H2O + 6CO2 + cahaya -> C6H12O6 + 6O2"

    def tahapan(self):
        return ["Reaksi terang di tilakoid", "Siklus Calvin di stroma"]

    def faktor_pembatas(self, light=600, co2=420, temp=27, water=70):
        """Kembalikan (laju, faktor_pembatas) untuk model free-tier."""
        f_light = light / (light + 200) if light > 0 else 0.0
        f_co2 = 0.0 if co2 <= 50 else (co2 - 50) / (co2 + 350)
        f_temp = math.exp(-((temp - 28) ** 2) / (2 * 8 * 8))
        if temp >= 45 or temp <= 5:
            f_temp *= 0.05
        f_water = max(0.0, water / 100) ** 0.7
        laju = self.PMAX * f_light * f_co2 * f_temp * f_water
        faktor = min(
            (("cahaya", f_light), ("CO2", f_co2), ("suhu", f_temp), ("air", f_water)),
            key=lambda kv: kv[1],
        )[0]
        if light == 0:
            faktor = "gelap — tanpa cahaya"
        return round(laju, 2), faktor

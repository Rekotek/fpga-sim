// Тестбенч урока 4: подаём такт на blink и смотрим, когда переключается LED0.
`timescale 1ns / 100ps                // #1 = 1 нс, точность 0,1 нс

module tb_top;
    reg  clk = 1'b0;                  // такт создаёт сам тестбенч
    wire led0;                        // выход схемы: только смотрим

    always #18.5 clk = ~clk;          // каждые 18,5 нс переворачиваем: период 37 нс (27 МГц)

    // Испытуемая схема. CLK_HZ = 20 вместо 27 млн: HALF = 20 / 2 - 1 = 9,
    // и светодиод переключается каждые 10 тактов, а не каждые 13,5 млн.
    top #(.CLK_HZ(20)) dut (.clk(clk), .led0(led0));

    integer ticks = 0;                // номер такта (сколько было фронтов)
    integer flips = 0;                // сколько раз переключился LED0

    always @(posedge clk) ticks = ticks + 1;

    always @(led0) if ($realtime > 0) begin   // момент 0 (начальное значение) не считаем
        flips = flips + 1;
        if (led0) $display("%t  такт %2d  LED0 погас", $realtime, ticks);
        else      $display("%t  такт %2d  LED0 горит", $realtime, ticks);
    end

    initial begin
        $timeformat(-9, 1, " нс", 9);   // печатать время в наносекундах
        $dumpfile("tb_top.vcd");        // файл временной диаграммы
        $dumpvars(0, tb_top);           // записать все сигналы тестбенча и схемы
        #(37 * 45);                     // ждём 45 тактов
        if (flips == 4) $display("ТЕСТ ПРОЙДЕН");
        else            $display("ТЕСТ НЕ ПРОЙДЕН: переключений %0d, ожидали 4", flips);
        $finish;                        // остановить симуляцию
    end
endmodule

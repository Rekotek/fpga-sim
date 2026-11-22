// Тестбенч урока 10, практика 2: радуга. Тот же приёмник WS2812, что в
// практике 1; ожидаемый цвет считает модель — та же формула колеса цветов
// от оттенка, который передатчик взял в начале кадра.
`timescale 1ns / 100ps

module tb_top;
    reg  clk = 1'b0;
    wire ws;

    always #18.5 clk = ~clk;              // 27 МГц

    // Шаг оттенка каждые 1000 тактов (37 мкс): за кадр ≈ 9 шагов.
    top #(.STEP_HZ(27_000)) dut (.clk(clk), .ws2812(ws));

    // Модель: колесо цветов и деление на 4, в формате G, R, B.
    function [23:0] wheel (input [7:0] hue);
        reg [7:0] h, r, g, b;
        begin
            r = 0;  g = 0;  b = 0;
            if (hue < 85)       begin h = hue;       r = 255 - 3*h;  g = 3*h;  end
            else if (hue < 170) begin h = hue - 85;  g = 255 - 3*h;  b = 3*h;  end
            else                begin h = hue - 170; b = 255 - 3*h;  r = 3*h;  end
            wheel = {g >> 2, r >> 2, b >> 2};
        end
    endfunction

    // Какой оттенок передатчик взял в кадр: смотрим в момент загрузки.
    reg [7:0] hue_loaded = 8'd0;
    always @(posedge clk)
        if (dut.led0.state == 2'd0 && dut.led0.start) hue_loaded <= dut.hue;

    // ---------- Приёмник WS2812 (как в практике 1, без проверки допусков) ----------
    reg  [23:0] grb, want;
    reg  [7:0]  hue_frame;
    integer     nb = 0, frames = 0, errors = 0;
    realtime    t_rise;

    always begin
        @(posedge ws);
        t_rise = $realtime;
        if (nb == 0) hue_frame = hue_loaded;      // первый бит кадра
        @(negedge ws);
        grb = {grb[22:0], ($realtime - t_rise > 600.0)};
        nb  = nb + 1;
        if (nb == 24) begin
            nb = 0;
            frames = frames + 1;
            want = wheel(hue_frame);
            if (frames % 3 == 1)
                $display("%3d    %3d     %h %h %h    %h %h %h", frames, hue_frame,
                         grb[23:16], grb[15:8], grb[7:0], want[23:16], want[15:8], want[7:0]);
            if (grb !== want) errors = errors + 1;
        end
    end

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("кадр  оттенок  G  R  B    ожидали");
        wait (frames == 30);
        $display("кадров %0d, последний оттенок %0d", frames, hue_frame);
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule

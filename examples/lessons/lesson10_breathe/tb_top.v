// Тестбенч урока 10, практика 4: «дыхание» цвета.
// Модель повторяет треугольник яркости и смену цвета на каждом вдохе
// (как модель урока 8); приёмник WS2812 сверяет каждый кадр с моделью.
`timescale 1ns / 100ps

module tb_top;
    reg  clk = 1'b0;
    wire ws;

    always #18.5 clk = ~clk;              // 27 МГц

    // Тик каждые 100 тактов: один вдох + выдох = 510 тиков ≈ 1,9 мс.
    top #(.STEP_HZ(270_000)) dut (.clk(clk), .ws2812(ws));

    // ---------- Модель ----------
    reg  [7:0] mv = 8'd0;                 // яркость до гаммы
    reg        mup = 1'b1;                // 1 — вдох
    integer    mc = 0, ticks = 0, errors = 0;

    always begin
        @(posedge clk);
        if (dut.tick) begin
            // такт с тиком: после него в схеме новые v и c
            if (mup) begin
                if (mv == 8'd255) begin mup = 1'b0; mv = 8'd254; end
                else              mv = mv + 1'b1;
            end else begin
                if (mv == 8'd0) begin mup = 1'b1; mv = 8'd1; mc = (mc + 1) % 6; end
                else            mv = mv - 1'b1;
            end
            ticks = ticks + 1;
            @(negedge clk);
            if (dut.v !== mv || dut.c !== mc) errors = errors + 1;
        end
    end

    // Ожидаемый цвет кадра в формате G, R, B.
    function [23:0] color (input [7:0] v, input [2:0] c);
        reg [15:0] sq;
        reg [7:0]  g;
        reg [2:0]  m;                     // {R, G, B}
        begin
            sq = v * v;
            g  = sq[15:9];
            case (c)
                0: m = 3'b100;  1: m = 3'b110;  2: m = 3'b010;
                3: m = 3'b011;  4: m = 3'b001;  default: m = 3'b101;
            endcase
            color = {m[1] ? g : 8'd0, m[2] ? g : 8'd0, m[0] ? g : 8'd0};
        end
    endfunction

    // Что передатчик взял в кадр: v и c в момент загрузки.
    reg [7:0] v_loaded = 8'd0;
    reg [2:0] c_loaded = 3'd0;
    always @(posedge clk)
        if (dut.led0.state == 2'd0 && dut.led0.start) begin
            v_loaded <= dut.v;
            c_loaded <= dut.c;
        end

    // ---------- Приёмник WS2812 ----------
    reg  [23:0] grb, want;
    reg  [7:0]  v_frame;
    reg  [2:0]  c_frame;
    integer     nb = 0, frames = 0;
    realtime    t_rise;

    always begin
        @(posedge ws);
        t_rise = $realtime;
        if (nb == 0) begin v_frame = v_loaded; c_frame = c_loaded; end
        @(negedge ws);
        grb = {grb[22:0], ($realtime - t_rise > 600.0)};
        nb  = nb + 1;
        if (nb == 24) begin
            nb = 0;
            frames = frames + 1;
            want = color(v_frame, c_frame);
            if (frames % 2 == 1)
                $display("%3d   %3d    %0d     %h %h %h    %h %h %h", frames, v_frame, c_frame,
                         grb[23:16], grb[15:8], grb[7:0], want[23:16], want[15:8], want[7:0]);
            if (grb !== want) errors = errors + 1;
        end
    end

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("кадр  яркость цвет   G  R  B    ожидали");
        wait (ticks == 1531);             // три вдоха и выдоха + тик: начался цвет 3
        @(negedge clk);
        $display("тиков %0d, кадров %0d, цвет сейчас %0d", ticks, frames, dut.c);
        if (dut.c !== 3'd3) errors = errors + 1;
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
